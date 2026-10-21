import type { RequestHandler } from 'express';

import type { AppConfig } from '@/config.js';
import type { PresencePort } from '@/types.js';

export function createWidgetController(
  config: AppConfig,
  presence: PresencePort
): RequestHandler {
  return (_req, res) => {
    const agents = presence.getOnlineAgentNames();
    res.json({
      agentName: config.agentName,
      online: agents.length > 0,
      agents,
    });
  };
}
