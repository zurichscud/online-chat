import type { RequestHandler } from 'express';

import type { ChatService } from '../../../application/services/chat.service';
import type { PresencePort } from '../../../domain/ports/presence.port';
import { asyncHandler } from '../middleware/async-handler';

export function createHealthController(
  chatService: ChatService,
  presence: PresencePort
): RequestHandler {
  return asyncHandler(async (_req, res) => {
    const conversations = await chatService.getConversationCount();
    res.json({
      ok: true,
      service: 'shiguang-live-chat',
      time: new Date().toISOString(),
      agentsOnline: presence.getAgentConnectionCount(),
      visitorsOnline: presence.getUniqueVisitorCount(),
      conversations,
    });
  });
}
