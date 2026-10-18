import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ChangePasswordPayload, LoginPayload } from '@cartograph/shared';
import { badRequest } from '../../core/errors.js';
import { requireSession } from './guard.js';
import { checkLoginRate, clearLoginRate } from './rateLimit.js';
import * as service from './service.js';

/**
 * SameSite=Lax + httpOnly: no script can read it, and it doesn't ride along on
 * cross-site requests. `secure` is opt-in because the instance sits behind the
 * proxy/Tailscale wall and may be reached over plain http (§ deployment posture).
 */
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(service.SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: service.SESSION_MAX_AGE_S,
    secure: COOKIE_SECURE,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // The one route outside the wall (§2). Everything else, including /auth/me,
  // needs a session.
  app.post('/auth/login', async (req, reply) => {
    const { username, password } = (req.body ?? {}) as Partial<LoginPayload>;
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      throw badRequest('Username and password are required.');
    }
    const name = service.normalizeUsername(username);
    checkLoginRate(name, req.ip);

    const { user, token } = await service.login(name, password);
    clearLoginRate(name, req.ip);
    setSessionCookie(reply, token);
    return { user };
  });

  await app.register(async (secure) => {
    secure.addHook('onRequest', requireSession);

    /** "Who am I" — the client's one call to decide login screen vs app (§8.2). */
    secure.get('/auth/me', async (req) => ({ user: req.user }));

    secure.post('/auth/logout', async (req, reply) => {
      service.logout(req.sessionToken);
      reply.clearCookie(service.SESSION_COOKIE, { path: '/' });
      return { ok: true };
    });

    secure.post('/auth/change-password', async (req, reply) => {
      const { currentPassword, newPassword } = (req.body ?? {}) as Partial<ChangePasswordPayload>;
      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        throw badRequest('Current and new password are required.');
      }
      const user = await service.changePassword(
        req.user!.id,
        currentPassword,
        newPassword,
        req.sessionToken,
      );
      // The surviving session is this one; refresh the cookie's window with it.
      if (req.sessionToken) setSessionCookie(reply, req.sessionToken);
      return { user };
    });
  });
}
