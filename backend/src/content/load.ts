// Reconstruit entièrement la base à partir du dossier de données (appelé au démarrage de l'API).
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { withTransaction } from '../db.js';
import { geometryMatchesKind, geometrySchema, kindSchema, yearSchema } from '../validation.js';
import { ALLOWED_UPLOAD_TYPES } from '../routes/media.js';
import { ensureDataDirs, entityFileNames, HISTORY_DIR, listFiles, MAP_DIR, parseMarkdown, UPLOAD_DIR, WIKI_DIR } from './files.js';

const entityFileSchema = z.object({
  entity: z.object({
    id: z.number().int().positive(),
    kind: kindSchema,
    name: z.string().trim().min(1),
    description: z.string().default(''),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#a0442c'),
    category: z.string().default(''),
    source: z.string().nullable().default(null),
    wiki: z.array(z.string()).default([]),
  }),
  features: z
    .array(
      z.object({
        properties: z.object({
          startYear: yearSchema,
          endYear: yearSchema.nullable().default(null),
          label: z.string().nullable().default(null),
        }),
        geometry: geometrySchema,
      }),
    )
    .min(1),
});

type EntityFile = z.infer<typeof entityFileSchema>;

const MIME_BY_EXT = Object.fromEntries(Object.entries(ALLOWED_UPLOAD_TYPES).map(([mime, ext]) => [ext, mime]));

const toDate = (value: string | undefined, fallback: Date) => {
  const d = value ? new Date(value) : fallback;
  return Number.isNaN(d.getTime()) ? fallback : d;
};

async function readEntities(warn: (msg: string) => void) {
  const entities: EntityFile[] = [];
  const seen = new Set<number>();
  let maxId = 0;
  entityFileNames.clear();

  for (const file of await listFiles(MAP_DIR, '.geojson')) {
    // On réserve aussi les ids des fichiers invalides pour ne jamais les écraser.
    const prefixId = Number(/^(\d+)-/.exec(file)?.[1] ?? 0);
    maxId = Math.max(maxId, prefixId);
    try {
      const data = entityFileSchema.parse(JSON.parse(await readFile(path.join(MAP_DIR, file), 'utf8')));
      const { id, kind } = data.entity;
      if (seen.has(id)) throw new Error(`id ${id} déjà utilisé par un autre fichier`);
      for (const f of data.features) {
        if (!geometryMatchesKind(kind, f.geometry)) throw new Error(`géométrie ${f.geometry.type} incompatible avec ${kind}`);
        const { startYear, endYear } = f.properties;
        if (endYear !== null && endYear < startYear) throw new Error(`période ${startYear}..${endYear} invalide`);
      }
      seen.add(id);
      maxId = Math.max(maxId, id);
      entities.push(data);
      entityFileNames.set(id, file);
    } catch (err) {
      warn(`map/${file} ignoré : ${err instanceof z.ZodError ? err.issues[0]?.message : (err as Error).message}`);
    }
  }
  return { entities, maxId };
}

async function readWiki() {
  const now = new Date();
  const pages = [];
  for (const file of await listFiles(WIKI_DIR, '.md')) {
    const slug = file.slice(0, -3);
    const { meta, body } = parseMarkdown(await readFile(path.join(WIKI_DIR, file), 'utf8'));
    const createdAt = toDate(meta.created, now);
    const revisions = [];
    for (const revFile of await listFiles(path.join(HISTORY_DIR, slug), '.md')) {
      const rev = parseMarkdown(await readFile(path.join(HISTORY_DIR, slug, revFile), 'utf8'));
      revisions.push({ title: rev.meta.title ?? slug, content: rev.body, created_at: toDate(rev.meta.created, createdAt) });
    }
    pages.push({
      slug,
      title: meta.title || slug,
      content: body,
      created_at: createdAt,
      updated_at: toDate(meta.updated, createdAt),
      revisions,
    });
  }
  return pages;
}

async function readUploads() {
  let names: string[] = [];
  try {
    names = await readdir(UPLOAD_DIR);
  } catch {
    return [];
  }
  const media = [];
  for (const filename of names.sort()) {
    const mime = MIME_BY_EXT[path.extname(filename).toLowerCase()];
    if (!mime) continue;
    const info = await stat(path.join(UPLOAD_DIR, filename));
    media.push({ filename, original_name: filename, mime_type: mime, size_bytes: info.size, created_at: info.mtime });
  }
  return media;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function rebuildFromFiles(log: (msg: string) => void, warn: (msg: string) => void) {
  await ensureDataDirs();
  const started = Date.now();
  const [{ entities, maxId }, pages, media] = await Promise.all([readEntities(warn), readWiki(), readUploads()]);

  await withTransaction(async (client) => {
    await client.query(
      'TRUNCATE entity_wiki_links, entity_versions, entities, wiki_revisions, wiki_pages, media RESTART IDENTITY',
    );

    for (const batch of chunks(pages, 200)) {
      await client.query(
        `INSERT INTO wiki_pages (slug, title, content, created_at, updated_at)
         SELECT slug, title, content, created_at, updated_at
         FROM json_to_recordset($1) AS x(slug text, title text, content text, created_at timestamptz, updated_at timestamptz)`,
        [JSON.stringify(batch)],
      );
    }
    const revisions = pages.flatMap((p) => p.revisions.map((r) => ({ ...r, slug: p.slug })));
    for (const batch of chunks(revisions, 500)) {
      await client.query(
        `INSERT INTO wiki_revisions (page_id, title, content, created_at)
         SELECT p.id, x.title, x.content, x.created_at
         FROM json_to_recordset($1) AS x(slug text, title text, content text, created_at timestamptz)
         JOIN wiki_pages p ON p.slug = x.slug`,
        [JSON.stringify(batch)],
      );
    }

    for (const batch of chunks(entities, 1000)) {
      await client.query(
        `INSERT INTO entities (id, kind, name, description, color, category, source)
         SELECT id, kind, name, description, color, category, source
         FROM json_to_recordset($1) AS x(id int, kind text, name text, description text, color text, category text, source text)`,
        [JSON.stringify(batch.map((e) => e.entity))],
      );
    }
    const versions = entities.flatMap((e) =>
      e.features.map((f) => ({
        entity_id: e.entity.id,
        start_year: f.properties.startYear,
        end_year: f.properties.endYear,
        label: f.properties.label,
        geometry: f.geometry,
      })),
    );
    for (const batch of chunks(versions, 500)) {
      await client.query(
        `INSERT INTO entity_versions (entity_id, start_year, end_year, label, geom)
         SELECT entity_id, start_year, end_year, label, ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326)
         FROM json_to_recordset($1) AS x(entity_id int, start_year int, end_year int, label text, geometry json)`,
        [JSON.stringify(batch)],
      );
    }
    const links = entities.flatMap((e) => e.entity.wiki.map((slug) => ({ entity_id: e.entity.id, slug })));
    for (const batch of chunks(links, 2000)) {
      await client.query(
        `INSERT INTO entity_wiki_links (entity_id, page_id)
         SELECT DISTINCT x.entity_id, p.id
         FROM json_to_recordset($1) AS x(entity_id int, slug text) JOIN wiki_pages p ON p.slug = x.slug`,
        [JSON.stringify(batch)],
      );
    }

    if (media.length) {
      await client.query(
        `INSERT INTO media (filename, original_name, mime_type, size_bytes, created_at)
         SELECT filename, original_name, mime_type, size_bytes, created_at
         FROM json_to_recordset($1) AS x(filename text, original_name text, mime_type text, size_bytes int, created_at timestamptz)`,
        [JSON.stringify(media)],
      );
    }

    await client.query("SELECT setval('entities_id_seq', GREATEST($1::int, 1), $1::int > 0)", [maxId]);
  });

  log(
    `Contenu chargé depuis le dossier de données en ${Date.now() - started} ms : ` +
      `${entities.length} éléments, ${pages.length} pages, ${media.length} images.`,
  );
}
