import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { removeWikiPage } from '../content/files.js';
import { syncEntities, syncWikiPage } from '../content/sync.js';
import { slugify } from '../slug.js';
import { pool, withTransaction } from '../db.js';
import { notFound } from '../errors.js';
import { idParam } from '../validation.js';

const pageBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(500000).default(''),
  entityIds: z.array(z.number().int()).optional(),
});
const slugParam = z.object({ slug: z.string().min(1).max(200) });

async function uniqueSlug(client: pg.PoolClient, title: string): Promise<string> {
  const base = slugify(title);
  const { rows } = await client.query<{ slug: string }>(
    `SELECT slug FROM wiki_pages WHERE slug = $1 OR slug LIKE $1 || '-%'`,
    [base],
  );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

async function linkedEntityIds(client: pg.PoolClient, pageId: number): Promise<number[]> {
  const { rows } = await client.query<{ entity_id: number }>(
    'SELECT entity_id FROM entity_wiki_links WHERE page_id = $1',
    [pageId],
  );
  return rows.map((r) => r.entity_id);
}

/** Les liens sont enregistrés dans les fichiers des éléments : on réécrit ceux qui gagnent ou perdent le lien. */
async function setEntityLinks(client: pg.PoolClient, pageId: number, entityIds: number[]) {
  const before = await linkedEntityIds(client, pageId);
  await client.query('DELETE FROM entity_wiki_links WHERE page_id = $1', [pageId]);
  if (entityIds.length) {
    await client.query(
      `INSERT INTO entity_wiki_links (entity_id, page_id)
       SELECT id, $1 FROM entities WHERE id = ANY($2::int[])`,
      [pageId, entityIds],
    );
  }
  const after = await linkedEntityIds(client, pageId);
  const changed = [...before.filter((id) => !after.includes(id)), ...after.filter((id) => !before.includes(id))];
  await syncEntities(client, changed);
}

async function getPage(slug: string) {
  const { rows } = await pool.query(
    `SELECT p.id, p.slug, p.title, p.content, p.created_at AS "createdAt", p.updated_at AS "updatedAt",
            COALESCE((
              SELECT json_agg(json_build_object(
                'id', e.id, 'name', e.name, 'kind', e.kind,
                'startYear', (SELECT MIN(v.start_year) FROM entity_versions v WHERE v.entity_id = e.id))
                ORDER BY e.name)
              FROM entity_wiki_links l JOIN entities e ON e.id = l.entity_id
              WHERE l.page_id = p.id), '[]') AS entities
     FROM wiki_pages p WHERE p.slug = $1`,
    [slug],
  );
  if (!rows[0]) throw notFound('Page');
  return rows[0];
}

export async function wikiRoutes(app: FastifyInstance) {
  app.get('/api/wiki', async (req) => {
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT id, slug, title, updated_at AS "updatedAt" FROM wiki_pages
       WHERE $1::text IS NULL OR title ILIKE '%' || $1 || '%' OR content ILIKE '%' || $1 || '%'
       ORDER BY title LIMIT 500`,
      [q || null],
    );
    return rows;
  });

  app.get('/api/wiki/:slug', async (req) => getPage(slugParam.parse(req.params).slug));

  app.post('/api/wiki', { preHandler: requireAdmin }, async (req, reply) => {
    const body = pageBodySchema.parse(req.body);
    const slug = await withTransaction(async (client) => {
      const slug = await uniqueSlug(client, body.title);
      const { rows } = await client.query<{ id: number }>(
        'INSERT INTO wiki_pages (slug, title, content) VALUES ($1, $2, $3) RETURNING id',
        [slug, body.title, body.content],
      );
      await client.query('INSERT INTO wiki_revisions (page_id, title, content) VALUES ($1, $2, $3)', [
        rows[0].id,
        body.title,
        body.content,
      ]);
      if (body.entityIds) await setEntityLinks(client, rows[0].id, body.entityIds);
      await syncWikiPage(client, slug, true);
      return slug;
    });
    reply.code(201);
    return getPage(slug);
  });

  // Le slug ne change pas quand le titre change, pour ne pas casser les liens existants.
  app.put('/api/wiki/:slug', { preHandler: requireAdmin }, async (req) => {
    const { slug } = slugParam.parse(req.params);
    const body = pageBodySchema.parse(req.body);
    await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: number }>(
        'UPDATE wiki_pages SET title = $2, content = $3, updated_at = now() WHERE slug = $1 RETURNING id',
        [slug, body.title, body.content],
      );
      if (!rows[0]) throw notFound('Page');
      await client.query('INSERT INTO wiki_revisions (page_id, title, content) VALUES ($1, $2, $3)', [
        rows[0].id,
        body.title,
        body.content,
      ]);
      if (body.entityIds) await setEntityLinks(client, rows[0].id, body.entityIds);
      await syncWikiPage(client, slug, true);
    });
    return getPage(slug);
  });

  app.delete('/api/wiki/:slug', { preHandler: requireAdmin }, async (req, reply) => {
    const { slug } = slugParam.parse(req.params);
    await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: number }>('SELECT id FROM wiki_pages WHERE slug = $1', [slug]);
      if (!rows[0]) throw notFound('Page');
      const linked = await linkedEntityIds(client, rows[0].id);
      await client.query('DELETE FROM wiki_pages WHERE id = $1', [rows[0].id]);
      await syncEntities(client, linked);
      await removeWikiPage(slug);
    });
    return reply.code(204).send();
  });

  app.get('/api/wiki/:slug/revisions', async (req) => {
    const { slug } = slugParam.parse(req.params);
    const { rows } = await pool.query(
      `SELECT r.id, r.title, r.created_at AS "createdAt"
       FROM wiki_revisions r JOIN wiki_pages p ON p.id = r.page_id
       WHERE p.slug = $1 ORDER BY r.created_at DESC`,
      [slug],
    );
    return rows;
  });

  app.get('/api/wiki/:slug/revisions/:id', async (req) => {
    const { slug } = slugParam.parse(req.params);
    const { id } = idParam.parse(req.params);
    const { rows } = await pool.query(
      `SELECT r.id, r.title, r.content, r.created_at AS "createdAt"
       FROM wiki_revisions r JOIN wiki_pages p ON p.id = r.page_id
       WHERE p.slug = $1 AND r.id = $2`,
      [slug, id],
    );
    if (!rows[0]) throw notFound('Révision');
    return rows[0];
  });
}
