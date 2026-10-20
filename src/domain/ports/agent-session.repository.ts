export interface AgentSession {
  token: string;
  name: string;
  expiresAt: number;
}

export interface AgentSessionRepository {
  issue(name: string): Promise<AgentSession>;
  find(token: string): Promise<AgentSession | null>;
  revoke(token: string): Promise<void>;
  cleanupExpired(): Promise<void>;
}
