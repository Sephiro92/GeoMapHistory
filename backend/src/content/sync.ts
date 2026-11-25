// Écrit dans le dossier de données l'état (éventuellement non commité) lu via le client de la transaction.
// Les routes l'appellent avant COMMIT : si l'écriture échoue, la modification est annulée.
import type pg from 'pg';
import { removeEntityFile, writeEntityFile, writeWikiPage, writeWikiRevision, type EntityFileData } from './files.js';

const ENTITY_FILE_SQL = `
  SELECT json_build_object(
    'entity', json_build_object(
      'id', e.id, 'kind', e.kind, 'name', e.name, 'description', e.description,
      'color', e.color, 'category', e.category, 'source', e.source,
      'wiki', COALESCE((SELECT json_agg(p.slug ORDER BY p.slug)
                        FROM entity_wiki_links l JOIN wiki_pages p ON p.id = l.page_id
                        WHERE l.entity_id = e.id), '[]')),
    'features', COALESCE((SELECT json_agg(json_build_object(
                  'type', 'Feature',
                  'properties', json_build_object('startYear', v.start_year, 'endYear', v.end_year, 'label', v.label),
                  'geometry', ST_AsGeoJSON(v.geom)::json) ORDER BY v.start_year)
                FROM entity_versions v WHERE v.entity_id = e.id), '[]')) AS data
  FROM entities e WHERE e.id = ANY($1::int[])`;

/** (Ré)écrit les fichiers des éléments donnés ; supprime ceux des éléments qui n'existent plus. */
export async function syncEntities(client: pg.PoolClient, ids: number[], onProgress?: (done: number) => void) {
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    const batch = unique.slice(i, i + 200);
    const { rows } = await client.query<{ data: EntityFileData }>(ENTITY_FILE_SQL, [batch]);
    const found = new Set<number>();
    for (const { data } of rows) {
      await writeEntityFile(data);
      found.add(data.entity.id);
    }
    for (const id of batch) if (!found.has(id)) await removeEntityFile(id);
    onProgress?.(Math.min(i + batch.length, unique.length));
  }
}

/** Écrit la page et, si demandé, sa dernière révision. */
export async function syncWikiPage(client: pg.PoolClient, slug: string, withLatestRevision: boolean) {
  const { rows } = await client.query<{ id: number; title: string; content: string; created_at: Date; updated_at: Date }>(
    'SELECT id, title, content, created_at, updated_at FROM wiki_pages WHERE slug = $1',
    [slug],
  );
  const page = rows[0];
  if (!page) return;
  await writeWikiPage({ slug, title: page.title, content: page.content, createdAt: page.created_at, updatedAt: page.updated_at });
  if (withLatestRevision) {
    const { rows: revs } = await client.query<{ title: string; content: string; created_at: Date }>(
      'SELECT title, content, created_at FROM wiki_revisions WHERE page_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
      [page.id],
    );
    if (revs[0]) await writeWikiRevision(slug, { title: revs[0].title, content: revs[0].content, createdAt: revs[0].created_at });
  }
}
