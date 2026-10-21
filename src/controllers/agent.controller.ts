import type { RequestHandler } from 'express';

import type { AuthService } from '@/services/auth.service.js';
import { asyncHandler } from '@/middleware/async-handler.js';
import {
  extractBearerToken,
  isRecord,
} from '@/utils/validation.js';

/** 客服认证相关的 HTTP 处理器。 */
export interface AuthController {
  /** 校验密码并签发令牌。 */
  login: RequestHandler;
  /** 撤销当前请求携带的令牌。 */
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
