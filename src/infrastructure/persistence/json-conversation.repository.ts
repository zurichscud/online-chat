import fs from 'node:fs/promises';
import path from 'node:path';

import { ConflictError } from '../../domain/errors';
import {
  MAX_MESSAGES_PER_CONVERSATION,
  type Conversation,
  type ConversationStatus,
} from '../../domain/entities/conversation';
import type { Message, MessageRole } from '../../domain/entities/message';
import type { ConversationRepository } from '../../domain/ports/conversation.repository';
import { logger } from '../../shared/logger';
import { isRecord } from '../../shared/validation';

interface StoreData {
  conversations: Conversation[];
}

const MESSAGE_ROLES: readonly MessageRole[] = ['visitor', 'agent', 'system'];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parseUnread(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function parseMessage(value: unknown): Message | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.text !== 'string') return null;
  if (typeof value.role !== 'string' || !MESSAGE_ROLES.includes(value.role as MessageRole)) {
    return null;
  }
  if (typeof value.at !== 'string') return null;

  const message: Message = {
    id: value.id,
    role: value.role as MessageRole,
    text: value.text,
    at: value.at,
    authorName: typeof value.authorName === 'string' ? value.authorName : '',
  };
  if (typeof value.clientId === 'string' && value.clientId.length > 0) {
    message.clientId = value.clientId;
  }
  return message;
}

function parseConversation(value: unknown): Conversation | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.visitorId !== 'string' || value.visitorId.length === 0) return null;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return null;
  if (value.status !== 'open' && value.status !== 'closed') return null;

  const messages = Array.isArray(value.messages)
    ? value.messages
        .map(parseMessage)
        .filter((message): message is Message => message !== null)
        .slice(-MAX_MESSAGES_PER_CONVERSATION)
    : [];

  return {
    id: value.id,
    visitorId: value.visitorId,
    visitorName:
      typeof value.visitorName === 'string' && value.visitorName
        ? value.visitorName
        : '访客',
    page: typeof value.page === 'string' ? value.page : '',
    userAgent: typeof value.userAgent === 'string' ? value.userAgent : '',
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    status: value.status as ConversationStatus,
    unreadForAgent: parseUnread(value.unreadForAgent),
    unreadForVisitor: parseUnread(value.unreadForVisitor),
    messages,
  };
}

/**
 * JSON file adapter. It keeps the demo independently runnable while exposing
 * the same repository contract that a MySQL adapter will implement later.
 */
export class JsonConversationRepository implements ConversationRepository {
  private readonly conversations = new Map<string, Conversation>();
  private saveTimer: NodeJS.Timeout | null = null;
  private flushChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly saveDelayMs = 250
  ) {}

  async initialize(): Promise<void> {
    this.conversations.clear();

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;

      if (!isRecord(parsed) || !Array.isArray(parsed.conversations)) {
        throw new Error('store.json must contain a conversations array');
      }

      for (const value of parsed.conversations) {
        const conversation = parseConversation(value);
        if (conversation) {
          this.conversations.set(conversation.id, conversation);
        } else {
          logger.warn({ file: this.filePath }, 'Skipped malformed conversation record');
        }
      }

      logger.info(
        { conversations: this.conversations.size, file: this.filePath },
        'Conversation store loaded'
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        logger.info({ file: this.filePath }, 'No conversation store yet, starting empty');
        return;
      }
      logger.error({ error, file: this.filePath }, 'Failed to read conversation store');
    }
  }

  async findById(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.get(id);
    return conversation ? clone(conversation) : null;
  }

  async findByVisitorId(visitorId: string): Promise<Conversation | null> {
    for (const conversation of this.conversations.values()) {
      if (conversation.visitorId === visitorId) return clone(conversation);
    }
    return null;
  }

  async listAll(): Promise<Conversation[]> {
    return [...this.conversations.values()].map(clone);
  }

  async create(conversation: Conversation): Promise<void> {
    if (this.conversations.has(conversation.id)) {
      throw new ConflictError('会话已存在。');
    }
    this.conversations.set(conversation.id, clone(conversation));
    this.scheduleSave();
  }

  async save(conversation: Conversation): Promise<void> {
    if (!this.conversations.has(conversation.id)) {
      throw new ConflictError('会话不存在，无法保存。');
    }
    this.conversations.set(conversation.id, clone(conversation));
    this.scheduleSave();
  }

  async delete(id: string): Promise<boolean> {
    const deleted = this.conversations.delete(id);
    if (deleted) this.scheduleSave();
    return deleted;
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    const data: StoreData = {
      conversations: [...this.conversations.values()],
    };
    const payload = JSON.stringify(data, null, 2);

    this.flushChain = this.flushChain
      .then(() => this.writeSnapshot(payload))
      .catch((error) => {
        logger.error({ error, file: this.filePath }, 'Failed to persist conversation store');
      });

    return this.flushChain;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, this.saveDelayMs);
  }

  private async writeSnapshot(payload: string): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempFile = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempFile, payload, 'utf8');
    await fs.rename(tempFile, this.filePath);
  }
}
