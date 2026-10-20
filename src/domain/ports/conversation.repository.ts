import type { Conversation } from '../entities/conversation';

export interface ConversationRepository {
  initialize(): Promise<void>;
  findById(id: string): Promise<Conversation | null>;
  findByVisitorId(visitorId: string): Promise<Conversation | null>;
  listAll(): Promise<Conversation[]>;
  create(conversation: Conversation): Promise<void>;
  save(conversation: Conversation): Promise<void>;
  delete(id: string): Promise<boolean>;
  flush(): Promise<void>;
}
