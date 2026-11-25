// Export et import du contenu (map/, wiki/, uploads/) sous forme d'archive zip.
// Le compte administrateur (.env, .session-secret) n'est jamais exporté ni remplacé par un import.
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { HttpError } from '../errors.js';
import { ALLOWED_UPLOAD_TYPES } from '../routes/media.js';
import { DATA_DIR } from './files.js';
import { rebuildFromFiles } from './load.js';

const CONTENT_DIRS = ['map', 'wiki', 'uploads'];
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const STAGING_DIR = path.join(DATA_DIR, '.import-staging');
const MAX_UNCOMPRESSED = 2 * 1024 ** 3;
const UPLOAD_EXTS = new Set(Object.values(ALLOWED_UPLOAD_TYPES));
const SAFE_SEGMENT = /^(?!\.\.?$)[^\\/:*?"<>|\x00-\x1f]+$/;

async function* walk(dir: string, rel: string): AsyncGenerator<{ abs: string; rel: string }> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(abs, `${rel}/${e.name}`);
    else if (e.isFile() && !e.name.endsWith('.tmp')) yield { abs, rel: `${rel}/${e.name}` };
  }
}

/** Archive zip du contenu, produite en flux. */
export function contentZipStream(): NodeJS.ReadableStream {
  const zip = new yazl.ZipFile();
  (async () => {
    for (const dir of CONTENT_DIRS) {
      for await (const file of walk(path.join(DATA_DIR, dir), dir)) zip.addFile(file.abs, file.rel);
    }
    zip.end();
  })().catch((err) => (zip.outputStream as NodeJS.ReadableStream & { destroy(e: Error): void }).destroy(err));
  return zip.outputStream;
}

/**
 * Chemin relatif à retenir pour une entrée de l'archive, ou null pour l'ignorer.
 * Accepte un éventuel dossier englobant (ex. « data/map/… ») et les archives de scripts/backup.ps1.
 */
function contentPath(fileName: string): string | null {
  if (fileName.endsWith('/')) return null;
  const segments = fileName.split('/');
  const start = segments.findIndex((s) => CONTENT_DIRS.includes(s));
  if (start < 0) return null;
  const rel = segments.slice(start);
  if (!rel.every((s) => SAFE_SEGMENT.test(s))) return null;
  const [dir, ...rest] = rel;
  const name = rest[rest.length - 1] ?? '';
  const ok =
    (dir === 'map' && rest.length === 1 && name.endsWith('.geojson')) ||
    (dir === 'wiki' && rest.length === 1 && name.endsWith('.md')) ||
    (dir === 'wiki' && rest.length === 3 && rest[0] === '.history' && name.endsWith('.md')) ||
    (dir === 'uploads' && rest.length === 1 && UPLOAD_EXTS.has(path.extname(name).toLowerCase()));
  return ok ? rel.join('/') : null;
}

/** Extrait les fichiers de contenu de l'archive dans `target`. */
async function extract(zipPath: string, target: string): Promise<{ files: number; skipped: number }> {
  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.openPromise(zipPath, { lazyEntries: true });
  } catch (err) {
    throw new HttpError(400, `Archive zip illisible : ${(err as Error).message}`);
  }
  let files = 0;
  let skipped = 0;
  let total = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', (err) => reject(new HttpError(400, `Archive zip invalide : ${err.message}`)));
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        const rel = contentPath(entry.fileName);
        if (!rel) {
          if (!entry.fileName.endsWith('/')) skipped++;
          zip.readEntry();
          return;
        }
        total += entry.uncompressedSize;
        if (total > MAX_UNCOMPRESSED) {
          reject(new HttpError(413, 'Archive trop volumineuse (plus de 2 Go décompressés)'));
          return;
        }
        const dest = path.join(target, ...rel.split('/'));
        zip.openReadStream(entry, (err, stream) => {
          if (err) return reject(new HttpError(400, `Entrée illisible : ${entry.fileName}`));
          mkdir(path.dirname(dest), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(dest)))
            .then(() => {
              files++;
              zip.readEntry();
            })
            .catch(reject);
        });
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  return { files, skipped };
}

let importing = false;
export const isImporting = () => importing;

/**
 * Remplace tout le contenu par celui de l'archive. Le contenu actuel est d'abord sauvegardé dans
 * data/backups/ ; en cas d'échec du rechargement, il est remis en place.
 */
export async function importContentZip(zipPath: string, log: (msg: string) => void, warn: (msg: string) => void) {
  if (importing) throw new HttpError(409, 'Un import est déjà en cours');
  importing = true;
  try {
    await rm(STAGING_DIR, { recursive: true, force: true });
    await mkdir(STAGING_DIR, { recursive: true });
    const { files, skipped } = await extract(zipPath, STAGING_DIR);
    if (files === 0) {
      throw new HttpError(400, 'Archive non reconnue : aucun fichier dans map/, wiki/ ou uploads/');
    }

    await mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `avant-import-${stamp}.zip`;
    await pipeline(contentZipStream(), createWriteStream(path.join(BACKUP_DIR, backup)));

    const swap = async (from: (d: string) => string, to: (d: string) => string) => {
      for (const dir of CONTENT_DIRS) {
        await rm(to(dir), { recursive: true, force: true });
        await rename(from(dir), to(dir)).catch(async (err) => {
          if (err.code !== 'ENOENT') throw err;
          await mkdir(to(dir), { recursive: true });
        });
      }
    };
    const live = (d: string) => path.join(DATA_DIR, d);
    const old = (d: string) => path.join(DATA_DIR, `.import-old-${d}`);
    const staged = (d: string) => path.join(STAGING_DIR, d);

    await swap(live, old);
    await swap(staged, live);
    try {
      await rebuildFromFiles(log, warn);
    } catch (err) {
      warn(`Import annulé, contenu précédent restauré : ${(err as Error).message}`);
      await swap(old, live);
      await rebuildFromFiles(log, warn);
      throw new HttpError(400, `Contenu de l'archive inutilisable : ${(err as Error).message}`);
    }
    for (const dir of CONTENT_DIRS) await rm(old(dir), { recursive: true, force: true });
    return { files, skipped, backup: `data/backups/${backup}` };
  } finally {
    await rm(STAGING_DIR, { recursive: true, force: true });
    importing = false;
  }
}
