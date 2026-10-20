import { WebSocket } from 'ws';

import {
  toConversationSummary,
  toMessageDto,
} from '../../application/mappers/conversation.mapper';
import type { ServerEvent } from '../../application/dto/protocol';
import type { Conversation } from '../../domain/entities/conversation';
import type { Message } from '../../domain/entities/message';
import type { ChatEventPublisher, ConversationAudience } from '../../domain/ports/chat-event.publisher';
import type { PresencePort } from '../../domain/ports/presence.port';
import { logger } from '../../shared/logger';

export interface VisitorConnection {
  visitorId: string;
  panelOpen: boolean;
}

export interface AgentConnection {
  name: string;
  focusedConversationId: string | null;
}

export interface AgentPresenceEvent {
  type: 'agent:presence';
  online: boolean;
  agents: string[];
}

/**
 * Owns live socket state and implements both presence queries and the semantic
 * realtime publisher. This is the only adapter that knows how to reach clients.
 */
export class ConnectionHub implements PresencePort, ChatEventPublisher {
  private readonly visitors = new Map<WebSocket, VisitorConnection>();
  private readonly agents = new Map<WebSocket, AgentConnection>();

  registerVisitor(ws: WebSocket, state: VisitorConnection): void {
    this.visitors.set(ws, state);
  }

  getVisitor(ws: WebSocket): VisitorConnection | undefined {
    return this.visitors.get(ws);
  }

  removeVisitor(ws: WebSocket): VisitorConnection | undefined {
    const state = this.visitors.get(ws);
    this.visitors.delete(ws);
    return state;
  }

  setVisitorPanel(ws: WebSocket, panelOpen: boolean): void {
    const state = this.visitors.get(ws);
    if (state) state.panelOpen = panelOpen;
  }

  registerAgent(ws: WebSocket, state: AgentConnection): void {
    this.agents.set(ws, state);
  }

  getAgent(ws: WebSocket): AgentConnection | undefined {
    return this.agents.get(ws);
  }

  removeAgent(ws: WebSocket): AgentConnection | undefined {
    const state = this.agents.get(ws);
    this.agents.delete(ws);
    return state;
  }

  setAgentFocus(ws: WebSocket, conversationId: string | null): void {
    const state = this.agents.get(ws);
    if (state) state.focusedConversationId = conversationId;
  }

  isVisitorOnline(visitorId: string): boolean {
    for (const state of this.visitors.values()) {
      if (state.visitorId === visitorId) return true;
    }
    return false;
  }

  hasOpenVisitorPanel(visitorId: string): boolean {
    for (const state of this.visitors.values()) {
      if (state.visitorId === visitorId && state.panelOpen) return true;
    }
    return false;
  }

  hasFocusedAgent(conversationId: string): boolean {
    for (const state of this.agents.values()) {
      if (state.focusedConversationId === conversationId) return true;
    }
    return false;
  }

  getOnlineAgentNames(): string[] {
    return [...new Set([...this.agents.values()].map((state) => state.name))];
  }

  getUniqueVisitorCount(): number {
    return new Set([...this.visitors.values()].map((state) => state.visitorId)).size;
  }

  getAgentConnectionCount(): number {
    return this.agents.size;
  }

  getPresenceEvent(): AgentPresenceEvent {
    const agents = this.getOnlineAgentNames();
    return {
      type: 'agent:presence',
      online: agents.length > 0,
      agents,
    };
  }

  send(ws: WebSocket, event: ServerEvent): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(event));
    } catch (error) {
      logger.warn({ error }, 'Failed to send WebSocket event');
    }
  }

  broadcastPresence(): void {
    const presence = this.getPresenceEvent();

    for (const ws of this.visitors.keys()) {
      this.send(ws, presence);
    }
    for (const ws of this.agents.keys()) {
      this.send(ws, { ...presence, connections: this.agents.size });
    }
  }

  publishMessage(
    conversation: Conversation,
    message: Message,
    audience: ConversationAudience = 'all'
  ): void {
    const event: ServerEvent = {
      type: 'message',
      conversationId: conversation.id,
      message: toMessageDto(message),
    };

    if (audience === 'all' || audience === 'visitor') {
      this.sendToVisitor(conversation.visitorId, event);
    }
    if (audience === 'all' || audience === 'agents') {
      this.sendToAgents(event);
    }
  }

  publishConversationUpdate(
    conversation: Conversation,
    audience: ConversationAudience = 'all'
  ): void {
    const event: ServerEvent = {
      type: 'conversation:update',
      conversation: toConversationSummary(
        conversation,
        this.isVisitorOnline(conversation.visitorId)
      ),
    };

    if (audience === 'all' || audience === 'visitor') {
      this.sendToVisitor(conversation.visitorId, event);
    }
    if (audience === 'all' || audience === 'agents') {
      this.sendToAgents(event);
    }
  }

  publishVisitorTyping(conversation: Conversation, active: boolean): void {
    const event: ServerEvent = {
      type: 'typing',
      conversationId: conversation.id,
      from: 'visitor',
      name: conversation.visitorName,
      active,
    };

    if (active) {
      this.sendToAgents(event);
    } else {
      this.sendToFocusedAgents(conversation.id, event);
    }
  }

  publishAgentTyping(
    conversation: Conversation,
    active: boolean,
    agentName: string
  ): void {
    this.sendToVisitor(conversation.visitorId, {
      type: 'typing',
      conversationId: conversation.id,
      from: 'agent',
      name: agentName,
      active,
    });
  }

  publishConversationRemoved(conversation: Conversation): void {
    const event: ServerEvent = {
      type: 'conversation:removed',
      conversationId: conversation.id,
    };
    this.sendToVisitor(conversation.visitorId, event);
    this.sendToAgents(event);
  }

  private sendToVisitor(visitorId: string, event: ServerEvent): void {
    for (const [ws, state] of this.visitors.entries()) {
      if (state.visitorId === visitorId) this.send(ws, event);
    }
  }

  private sendToAgents(event: ServerEvent): void {
    for (const ws of this.agents.keys()) this.send(ws, event);
  }

  private sendToFocusedAgents(conversationId: string, event: ServerEvent): void {
    for (const [ws, state] of this.agents.entries()) {
      if (state.focusedConversationId === conversationId) this.send(ws, event);
    }
  }
}
