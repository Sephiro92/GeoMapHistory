import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth.js';
import { pool } from '../db.js';

/** Export JSON lisible de tout le contenu (hors fichiers images), en complément des dumps SQL. */
export async function exportRoutes(app: FastifyInstance) {
  app.get('/api/export', { preHandler: requireAdmin }, async (_req, reply) => {
    const [entities, pages, media] = await Promise.all([
      pool.query(`
        SELECT e.id, e.kind, e.name, e.description, e.color, e.category, e.source,
               COALESCE((SELECT json_agg(json_build_object(
                 'startYear', v.start_year, 'endYear', v.end_year, 'label', v.label,
                 'geometry', ST_AsGeoJSON(v.geom)::json) ORDER BY v.start_year)
                 FROM entity_versions v WHERE v.entity_id = e.id), '[]') AS versions,
               COALESCE((SELECT json_agg(p.slug) FROM entity_wiki_links l
                 JOIN wiki_pages p ON p.id = l.page_id WHERE l.entity_id = e.id), '[]') AS "wikiSlugs"
        FROM entities e ORDER BY e.id`),
      pool.query('SELECT slug, title, content, created_at AS "createdAt", updated_at AS "updatedAt" FROM wiki_pages ORDER BY slug'),
      pool.query('SELECT filename, original_name AS "originalName", mime_type AS "mimeType" FROM media ORDER BY id'),
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header('Content-Disposition', `attachment; filename="geomaphistory-${stamp}.json"`);
    return {
      exportedAt: new Date().toISOString(),
      entities: entities.rows,
      wikiPages: pages.rows,
      media: media.rows,
    };
  });
}
