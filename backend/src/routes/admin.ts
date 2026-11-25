import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';
import { contentZipStream, importContentZip, isImporting } from '../content/archive.js';
import { HttpError } from '../errors.js';
import { countHistoricalBorders, importHistoricalBorders, removeHistoricalBorders } from '../content/historical.js';

// Import et retrait prennent jusqu'à une minute : ils tournent en tâche de fond, l'interface suit l'état.
interface Job {
  action: 'import' | 'remove';
  state: 'running' | 'done' | 'error';
  message: string;
  startedAt: string;
}

let job: Job | null = null;

function startJob(action: Job['action'], run: (progress: (msg: string) => void) => Promise<string>) {
  if (job?.state === 'running' || isImporting()) throw new HttpError(409, 'Une opération est déjà en cours');
  const current: Job = { action, state: 'running', message: 'Démarrage…', startedAt: new Date().toISOString() };
  job = current;
  run((msg) => (current.message = msg))
    .then((msg) => Object.assign(current, { state: 'done', message: msg }))
    .catch((err) => Object.assign(current, { state: 'error', message: err.message ?? String(err) }));
  return current;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/historical-borders', { preHandler: requireAdmin }, async () => ({
    imported: await countHistoricalBorders(),
    job,
  }));

  app.post('/api/admin/historical-borders', { preHandler: requireAdmin }, async (_req, reply) => {
    if ((await countHistoricalBorders()) > 0) throw new HttpError(409, 'Les frontières historiques sont déjà importées');
    reply.code(202);
    return startJob('import', async (progress) => {
      const r = await importHistoricalBorders(progress);
      return `Import terminé : ${r.entities} territoires, ${r.versions} versions.`;
    });
  });

  // Export du contenu (sans le compte administrateur).
  app.get('/api/admin/content', { preHandler: requireAdmin }, async (_req, reply) => {
    const stamp = new Date().toISOString().slice(0, 10);
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="geomaphistory-data-${stamp}.zip"`);
    return reply.send(contentZipStream());
  });

  // Import : remplace tout le contenu par celui de l'archive envoyée.
  app.post('/api/admin/content', { preHandler: requireAdmin }, async (req) => {
    if (job?.state === 'running') throw new HttpError(409, 'Une opération est déjà en cours');
    const file = await req.file({ limits: { fileSize: 2 * 1024 ** 3, files: 1 } });
    if (!file) throw new HttpError(400, 'Aucun fichier reçu');
    const tmp = path.join(tmpdir(), `geomap-import-${randomUUID()}.zip`);
    try {
      await pipeline(file.file, createWriteStream(tmp));
      if (file.file.truncated) throw new HttpError(413, 'Archive trop volumineuse (2 Go maximum)');
      const result = await importContentZip(
        tmp,
        (msg) => req.log.info(msg),
        (msg) => req.log.warn(msg),
      );
      return {
        ...result,
        message:
          `Import terminé : ${result.files} fichiers chargés` +
          (result.skipped ? `, ${result.skipped} ignorés` : '') +
          `. Ancien contenu sauvegardé dans ${result.backup}.`,
      };
    } finally {
      await rm(tmp, { force: true });
    }
  });

  app.delete('/api/admin/historical-borders', { preHandler: requireAdmin }, async (_req, reply) => {
    reply.code(202);
    return startJob('remove', async (progress) => {
      const n = await removeHistoricalBorders(progress);
      return `${n} territoires retirés.`;
    });
  });
}
