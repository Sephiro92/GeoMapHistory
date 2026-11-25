import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { syncEntities } from '../content/sync.js';
import { pool, withTransaction } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import {
  entityCreateSchema,
  entityFieldsSchema,
  geometryMatchesKind,
  geometrySchema,
  idParam,
  type Kind,
  versionPatchSchema,
  versionSchema,
  yearSchema,
} from '../validation.js';

type Geometry = z.infer<typeof geometrySchema>;

async function assertValidGeometry(client: pg.PoolClient, kind: Kind, geometry: Geometry) {
  if (!geometryMatchesKind(kind, geometry)) {
    throw new HttpError(400, kind === 'point' ? 'Un point attend une géométrie Point' : 'Une zone attend un polygone');
  }
  const { rows } = await client.query<{ valid: boolean; reason: string }>(
    'SELECT ST_IsValid(g) AS valid, ST_IsValidReason(g) AS reason FROM (SELECT ST_GeomFromGeoJSON($1) AS g) s',
    [JSON.stringify(geometry)],
  );
  if (!rows[0].valid) throw new HttpError(400, `Géométrie invalide : ${rows[0].reason}`);
}

async function entityKind(client: pg.PoolClient, entityId: number): Promise<Kind> {
  const { rows } = await client.query<{ kind: Kind }>('SELECT kind FROM entities WHERE id = $1', [entityId]);
  if (!rows[0]) throw notFound('Entité');
  return rows[0].kind;
}

async function setWikiLinks(client: pg.PoolClient, entityId: number, pageIds: number[]) {
  await client.query('DELETE FROM entity_wiki_links WHERE entity_id = $1', [entityId]);
  if (pageIds.length) {
    await client.query(
      `INSERT INTO entity_wiki_links (entity_id, page_id)
       SELECT $1, id FROM wiki_pages WHERE id = ANY($2::int[])`,
      [entityId, pageIds],
    );
  }
}

const ENTITY_DETAIL_SQL = `
  SELECT e.id, e.kind, e.name, e.description, e.color, e.category,
         e.created_at AS "createdAt", e.updated_at AS "updatedAt",
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', v.id, 'startYear', v.start_year, 'endYear', v.end_year, 'label', v.label,
             'geometry', ST_AsGeoJSON(v.geom)::json) ORDER BY v.start_year)
           FROM entity_versions v WHERE v.entity_id = e.id), '[]') AS versions,
         COALESCE((
           SELECT json_agg(json_build_object('id', p.id, 'slug', p.slug, 'title', p.title) ORDER BY p.title)
           FROM entity_wiki_links l JOIN wiki_pages p ON p.id = l.page_id
           WHERE l.entity_id = e.id), '[]') AS "wikiPages"
  FROM entities e WHERE e.id = $1`;

async function getEntity(id: number) {
  const { rows } = await pool.query(ENTITY_DETAIL_SQL, [id]);
  if (!rows[0]) throw notFound('Entité');
  return rows[0];
}

export async function mapRoutes(app: FastifyInstance) {
  // Toutes les géométries valides à une année donnée, en GeoJSON.
  // 5 décimales (~1 m) suffisent à l'affichage ; l'édition relit la géométrie complète via /api/entities/:id.
  app.get('/api/features', async (req) => {
    const { year } = z.object({ year: z.coerce.number().pipe(yearSchema) }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT json_build_object('type', 'FeatureCollection', 'features', COALESCE(json_agg(f), '[]')) AS fc
       FROM (
         SELECT json_build_object(
           'type', 'Feature',
           'id', v.id,
           'geometry', ST_AsGeoJSON(v.geom, 5)::json,
           'properties', json_build_object(
             'entityId', e.id, 'versionId', v.id, 'kind', e.kind,
             'name', COALESCE(v.label, e.name), 'color', e.color, 'category', e.category,
             'startYear', v.start_year, 'endYear', v.end_year,
             -- Point d'étiquette unique, sur le plus grand morceau de la zone.
             'labelAt', CASE WHEN e.kind = 'zone' THEN (
               SELECT ST_AsGeoJSON(ST_PointOnSurface(d.geom), 4)::json->'coordinates'
               FROM ST_Dump(v.geom) d ORDER BY ST_Area(d.geom) DESC LIMIT 1) END)) AS f
         FROM entity_versions v JOIN entities e ON e.id = v.entity_id
         WHERE v.start_year <= $1 AND (v.end_year IS NULL OR v.end_year >= $1)
         ORDER BY ST_Area(v.geom) DESC
       ) s`,
      [year],
    );
    return rows[0].fc;
  });

  app.get('/api/entities', async (req) => {
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT e.id, e.kind, e.name, e.category,
              MIN(v.start_year) AS "startYear",
              CASE WHEN bool_or(v.end_year IS NULL) THEN NULL ELSE MAX(v.end_year) END AS "endYear"
       FROM entities e LEFT JOIN entity_versions v ON v.entity_id = e.id
       WHERE $1::text IS NULL OR e.name ILIKE '%' || $1 || '%'
       GROUP BY e.id ORDER BY e.name LIMIT 200`,
      [q || null],
    );
    return rows;
  });

  app.get('/api/entities/:id', async (req) => getEntity(idParam.parse(req.params).id));

  app.post('/api/entities', { preHandler: requireAdmin }, async (req, reply) => {
    const body = entityCreateSchema.parse(req.body);
    const id = await withTransaction(async (client) => {
      await assertValidGeometry(client, body.kind, body.version.geometry);
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO entities (kind, name, description, color, category)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [body.kind, body.name, body.description, body.color, body.category],
      );
      const entityId = rows[0].id;
      const v = body.version;
      await client.query(
        `INSERT INTO entity_versions (entity_id, start_year, end_year, label, geom)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326))`,
        [entityId, v.startYear, v.endYear, v.label || null, JSON.stringify(v.geometry)],
      );
      await setWikiLinks(client, entityId, body.wikiPageIds);
      await syncEntities(client, [entityId]);
      return entityId;
    });
    reply.code(201);
    return getEntity(id);
  });

  app.patch('/api/entities/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = entityFieldsSchema.partial().parse(req.body);
    await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE entities SET
           name = COALESCE($2, name), description = COALESCE($3, description),
           color = COALESCE($4, color), category = COALESCE($5, category), updated_at = now()
         WHERE id = $1`,
        [id, body.name, body.description, body.color, body.category],
      );
      if (!rowCount) throw notFound('Entité');
      await syncEntities(client, [id]);
    });
    return getEntity(id);
  });

  app.delete('/api/entities/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await withTransaction(async (client) => {
      const { rowCount } = await client.query('DELETE FROM entities WHERE id = $1', [id]);
      if (!rowCount) throw notFound('Entité');
      await syncEntities(client, [id]);
    });
    return reply.code(204).send();
  });

  app.put('/api/entities/:id/wiki-links', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { pageIds } = z.object({ pageIds: z.array(z.number().int()) }).parse(req.body);
    await withTransaction(async (client) => {
      await entityKind(client, id);
      await setWikiLinks(client, id, pageIds);
      await syncEntities(client, [id]);
    });
    return getEntity(id);
  });

  app.post('/api/entities/:id/versions', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const v = versionSchema.parse(req.body);
    await withTransaction(async (client) => {
      await assertValidGeometry(client, await entityKind(client, id), v.geometry);
      await client.query(
        `INSERT INTO entity_versions (entity_id, start_year, end_year, label, geom)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326))`,
        [id, v.startYear, v.endYear, v.label || null, JSON.stringify(v.geometry)],
      );
      await client.query('UPDATE entities SET updated_at = now() WHERE id = $1', [id]);
      await syncEntities(client, [id]);
    });
    reply.code(201);
    return getEntity(id);
  });

  app.patch('/api/versions/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = versionPatchSchema.parse(req.body);
    const entityId = await withTransaction(async (client) => {
      const { rows } = await client.query<{ entity_id: number; start_year: number; end_year: number | null }>(
        'SELECT entity_id, start_year, end_year FROM entity_versions WHERE id = $1 FOR UPDATE',
        [id],
      );
      const current = rows[0];
      if (!current) throw notFound('Version');
      const start = body.startYear ?? current.start_year;
      const end = body.endYear === undefined ? current.end_year : body.endYear;
      if (end !== null && end < start) {
        throw new HttpError(400, "L'année de fin doit être postérieure ou égale à l'année de début");
      }
      if (body.geometry) {
        await assertValidGeometry(client, await entityKind(client, current.entity_id), body.geometry);
      }
      await client.query(
        `UPDATE entity_versions SET
           start_year = $2, end_year = $3,
           label = CASE WHEN $4::boolean THEN $5 ELSE label END,
           geom = COALESCE(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), geom)
         WHERE id = $1`,
        [
          id,
          start,
          end,
          body.label !== undefined,
          body.label || null,
          body.geometry ? JSON.stringify(body.geometry) : null,
        ],
      );
      await client.query('UPDATE entities SET updated_at = now() WHERE id = $1', [current.entity_id]);
      await syncEntities(client, [current.entity_id]);
      return current.entity_id;
    });
    return getEntity(entityId);
  });

  app.delete('/api/versions/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const entityId = await withTransaction(async (client) => {
      const { rows } = await client.query<{ entity_id: number; count: string }>(
        `SELECT entity_id, (SELECT count(*) FROM entity_versions o WHERE o.entity_id = v.entity_id) AS count
         FROM entity_versions v WHERE id = $1`,
        [id],
      );
      if (!rows[0]) throw notFound('Version');
      if (Number(rows[0].count) <= 1) {
        throw new HttpError(409, "Impossible de supprimer la dernière version : supprimez plutôt l'entité");
      }
      await client.query('DELETE FROM entity_versions WHERE id = $1', [id]);
      await syncEntities(client, [rows[0].entity_id]);
      return rows[0].entity_id;
    });
    return getEntity(entityId);
  });
}
