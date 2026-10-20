import type { AppConfig } from './config/env';
import { AuthService } from './application/services/auth.service';
import { ChatService } from './application/services/chat.service';
import { InMemoryAgentSessionRepository } from './infrastructure/auth/in-memory-agent-session.repository';
import { ConnectionHub } from './infrastructure/realtime/connection.hub';
import { JsonConversationRepository } from './infrastructure/persistence/json-conversation.repository';
import {
  FixedWindowRateLimiter,
  LoginAttemptLimiter,
} from './shared/rate-limiter';

export interface AppContainer {
  repository: JsonConversationRepository;
  authService: AuthService;
  chatService: ChatService;
  hub: ConnectionHub;
}

export async function createContainer(config: AppConfig): Promise<AppContainer> {
  const repository = new JsonConversationRepository(config.dataFile);
  await repository.initialize();

  const sessions = new InMemoryAgentSessionRepository(config.agentTokenTtlMs);
  const loginAttempts = new LoginAttemptLimiter(8, 10 * 60 * 1000);
  const messageRateLimiter = new FixedWindowRateLimiter(20, 10_000);

  const authService = new AuthService({
    sessions,
    loginAttempts,
    agentName: config.agentName,
    agentPassword: config.agentPassword,
    tokenTtlMs: config.agentTokenTtlMs,
  });

  const hub = new ConnectionHub();
  const chatService = new ChatService({
    repository,
    presence: hub,
    publisher: hub,
    messageRateLimiter,
  });

  return { repository, authService, chatService, hub };
}
