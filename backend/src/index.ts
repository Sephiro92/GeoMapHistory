import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { loadAccount } from './account.js';
import { authRoutes, jwtCookieOptions } from './auth.js';
import { ensureDataDirs, UPLOAD_DIR } from './content/files.js';
import { rebuildFromFiles } from './content/load.js';
import { migrate } from './db.js';
import { adminRoutes } from './routes/admin.js';
import { exportRoutes } from './routes/export.js';
import { mapRoutes } from './routes/map.js';
import { mediaRoutes } from './routes/media.js';
import { wikiRoutes } from './routes/wiki.js';

if (!process.env.DATABASE_URL) throw new Error("Variable d'environnement manquante : DATABASE_URL");

await ensureDataDirs();
const account = await loadAccount();

const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || 'requête'} : ${i.message}`).join(' ; ');
    return reply.code(400).send({ error: message });
  }
  const { statusCode, message } = err as { statusCode?: number; message?: string };
  const status = statusCode ?? 500;
  if (status >= 500) req.log.error(err);
  return reply.code(status).send({ error: status >= 500 ? 'Erreur interne' : message });
});

await app.register(fastifyCookie);
await app.register(fastifyJwt, { secret: account.jwtSecret, cookie: jwtCookieOptions });
await app.register(fastifyRateLimit, { global: false });
await app.register(fastifyMultipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

await app.register(fastifyStatic, {
  root: UPLOAD_DIR,
  prefix: '/uploads/',
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
});

await app.register(authRoutes, { account });
await app.register(mapRoutes);
await app.register(wikiRoutes);
await app.register(mediaRoutes);
await app.register(exportRoutes);
await app.register(adminRoutes);

app.get('/api/health', async () => ({ ok: true }));

// Le contenu fait foi dans le dossier de données : la base est reconstruite à chaque démarrage.
await migrate((msg) => app.log.info(msg));
await rebuildFromFiles(
  (msg) => app.log.info(msg),
  (msg) => app.log.warn(msg),
);
await app.listen({ host: '0.0.0.0', port: 3000 });
