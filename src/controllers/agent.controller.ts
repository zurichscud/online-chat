import type { RequestHandler } from 'express';

import type { AuthService } from '@/services/auth.service.js';
import { asyncHandler } from '@/middleware/async-handler.js';
import {
  extractBearerToken,
  isRecord,
} from '@/utils/validation.js';

export interface AuthController {
  login: RequestHandler;
  logout: RequestHandler;
}

export function createAuthController(authService: AuthService): AuthController {
  const login = asyncHandler(async (req, res) => {
    const password =
      isRecord(req.body) && typeof req.body.password === 'string'
        ? req.body.password
        : '';
    const ip = req.socket.remoteAddress || req.ip || 'unknown';

    const result = await authService.login(password, ip);
    res.json(result);
  });

  const logout = asyncHandler(async (req, res) => {
    const token = extractBearerToken(req.get('authorization'));
    if (token) await authService.logout(token);
    res.json({ ok: true });
  });

  return { login, logout };
}
