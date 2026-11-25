import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';
import { UPLOAD_DIR } from '../content/files.js';
import { pool } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { idParam } from '../validation.js';

// Le SVG est exclu volontairement : servi depuis le même domaine, il pourrait exécuter du script.
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

export async function mediaRoutes(app: FastifyInstance) {
  app.get('/api/media', async () => {
    const { rows } = await pool.query(
      `SELECT id, filename, original_name AS "originalName", mime_type AS "mimeType",
              size_bytes AS "sizeBytes", created_at AS "createdAt",
              '/uploads/' || filename AS url
       FROM media ORDER BY created_at DESC`,
    );
    return rows;
  });

  app.post('/api/media', { preHandler: requireAdmin }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Aucun fichier reçu');
    const ext = ALLOWED_UPLOAD_TYPES[file.mimetype];
    if (!ext) throw new HttpError(415, `Type non accepté : ${file.mimetype}`);

    const filename = `${randomUUID()}${ext}`;
    const target = path.join(UPLOAD_DIR, filename);
    await pipeline(file.file, createWriteStream(target));
    if (file.file.truncated) {
      await unlink(target);
      throw new HttpError(413, 'Fichier trop volumineux');
    }
    const { size } = await stat(target);
    const { rows } = await pool.query(
      `INSERT INTO media (filename, original_name, mime_type, size_bytes) VALUES ($1, $2, $3, $4)
       RETURNING id, filename, original_name AS "originalName", mime_type AS "mimeType",
                 size_bytes AS "sizeBytes", created_at AS "createdAt", '/uploads/' || filename AS url`,
      [filename, file.filename, file.mimetype, size],
    );
    reply.code(201);
    return rows[0];
  });

  app.delete('/api/media/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { rows } = await pool.query<{ filename: string }>('DELETE FROM media WHERE id = $1 RETURNING filename', [id]);
    if (!rows[0]) throw notFound('Média');
    await unlink(path.join(UPLOAD_DIR, rows[0].filename)).catch(() => undefined);
    return reply.code(204).send();
  });
}
