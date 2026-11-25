import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Account } from './account.js';

const COOKIE_NAME = 'geomap_token';
const SESSION_SECONDS = 7 * 24 * 3600;

function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** preHandler : refuse la requête si l'utilisateur n'est pas l'admin connecté. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Authentification requise' });
  }
}

export async function isAdmin(req: FastifyRequest): Promise<boolean> {
  try {
    await req.jwtVerify();
    return true;
  } catch {
    return false;
  }
}

export async function authRoutes(app: FastifyInstance, opts: { account: Account }) {
  const { username: adminUser, password: adminPassword } = opts.account;

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z.object({ username: z.string(), password: z.string() }).parse(req.body);
      const ok = sameSecret(body.username, adminUser) && sameSecret(body.password, adminPassword);
      if (!ok) return reply.code(401).send({ error: 'Identifiants invalides' });

      const token = await reply.jwtSign({ sub: adminUser, role: 'admin' }, { expiresIn: SESSION_SECONDS });
      reply.setCookie(COOKIE_NAME, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        maxAge: SESSION_SECONDS,
      });
      return { username: adminUser };
    },
  );

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ admin: await isAdmin(req) }));
}

export const jwtCookieOptions = { cookieName: COOKIE_NAME, signed: false };
