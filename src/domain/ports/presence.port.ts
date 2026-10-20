/**
 * Queries against live connection state. The in-memory adapter powers the
 * single-process demo; a Redis adapter can replace it without changing the
 * application services.
 */
export interface PresencePort {
  isVisitorOnline(visitorId: string): boolean;
  hasOpenVisitorPanel(visitorId: string): boolean;
  hasFocusedAgent(conversationId: string): boolean;
  getOnlineAgentNames(): string[];
  getUniqueVisitorCount(): number;
  getAgentConnectionCount(): number;
}
