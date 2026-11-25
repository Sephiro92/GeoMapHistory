// Contenu édité stocké en fichiers dans le dossier de données (./data côté hôte, monté sur /data) :
//
//   map/<id>-<nom>.geojson            un élément de la carte et toutes ses versions
//   wiki/<slug>.md                    une page du wiki (en-tête + Markdown)
//   wiki/.history/<slug>/<date>.md    les révisions d'une page
//   uploads/<fichier>                 les images
//
// La base PostgreSQL n'est qu'un index reconstruit depuis ces fichiers au démarrage.
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { slugify } from '../slug.js';

export const DATA_DIR = process.env.DATA_DIR ?? '/data';
export const MAP_DIR = path.join(DATA_DIR, 'map');
export const WIKI_DIR = path.join(DATA_DIR, 'wiki');
export const HISTORY_DIR = path.join(WIKI_DIR, '.history');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

export async function ensureDataDirs() {
  for (const dir of [MAP_DIR, WIKI_DIR, HISTORY_DIR, UPLOAD_DIR]) await mkdir(dir, { recursive: true });
}

/** Écrit via un fichier temporaire puis renomme : un fichier n'est jamais à moitié écrit. */
async function writeAtomic(file: string, content: string) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}

// ---------- Carte ----------

export interface EntityFileData {
  entity: {
    id: number;
    kind: 'point' | 'zone';
    name: string;
    description: string;
    color: string;
    category: string;
    source: string | null;
    wiki: string[];
  };
  features: {
    type: 'Feature';
    properties: { startYear: number; endYear: number | null; label: string | null };
    geometry: unknown;
  }[];
}

/** Nom de fichier actuel de chaque élément (l'id seul est stable, le nom peut changer). */
export const entityFileNames = new Map<number, string>();

export const entityFileName = (id: number, name: string) => `${id}-${slugify(name).slice(0, 60)}.geojson`;

/** GeoJSON valide (FeatureCollection) ; en-tête lisible, une version par ligne. */
function formatEntityFile(data: EntityFileData): string {
  const header = JSON.stringify(data.entity, null, 2).replace(/\n/g, '\n  ');
  const features = data.features.map((f) => `    ${JSON.stringify(f)}`).join(',\n');
  return `{\n  "type": "FeatureCollection",\n  "entity": ${header},\n  "features": [\n${features}\n  ]\n}\n`;
}

export async function writeEntityFile(data: EntityFileData) {
  const name = entityFileName(data.entity.id, data.entity.name);
  await writeAtomic(path.join(MAP_DIR, name), formatEntityFile(data));
  const previous = entityFileNames.get(data.entity.id);
  if (previous && previous !== name) await rm(path.join(MAP_DIR, previous), { force: true });
  entityFileNames.set(data.entity.id, name);
}

export async function removeEntityFile(id: number) {
  const name = entityFileNames.get(id);
  if (name) await rm(path.join(MAP_DIR, name), { force: true });
  entityFileNames.delete(id);
}

// ---------- Wiki ----------

export interface MarkdownDoc {
  meta: Record<string, string>;
  body: string;
}

export function formatMarkdown(meta: Record<string, string>, body: string): string {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

export function parseMarkdown(text: string): MarkdownDoc {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { meta: {}, body: normalized };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const raw = line.slice(i + 1).trim();
    let value = raw;
    if (raw.startsWith('"')) {
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw.slice(1, -1);
      }
    }
    meta[line.slice(0, i).trim()] = value;
  }
  return { meta, body: normalized.slice(match[0].length).replace(/^\n/, '') };
}

const revisionFileName = (createdAt: Date) => `${createdAt.toISOString().replace(/[:.]/g, '-')}.md`;

export async function writeWikiPage(page: { slug: string; title: string; content: string; createdAt: Date; updatedAt: Date }) {
  const meta = { title: page.title, created: page.createdAt.toISOString(), updated: page.updatedAt.toISOString() };
  await writeAtomic(path.join(WIKI_DIR, `${page.slug}.md`), formatMarkdown(meta, page.content));
}

export async function writeWikiRevision(slug: string, rev: { title: string; content: string; createdAt: Date }) {
  const dir = path.join(HISTORY_DIR, slug);
  await mkdir(dir, { recursive: true });
  const meta = { title: rev.title, created: rev.createdAt.toISOString() };
  await writeAtomic(path.join(dir, revisionFileName(rev.createdAt)), formatMarkdown(meta, rev.content));
}

export async function removeWikiPage(slug: string) {
  await rm(path.join(WIKI_DIR, `${slug}.md`), { force: true });
  await rm(path.join(HISTORY_DIR, slug), { recursive: true, force: true });
}

export async function listFiles(dir: string, ext: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isFile() && d.name.endsWith(ext))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}
