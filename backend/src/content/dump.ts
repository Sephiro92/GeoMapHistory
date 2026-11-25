// Écrit tout le contenu de la base dans le dossier de données (migration depuis une ancienne installation).
// Usage : node dist/content/dump.js [--exclude-source=historical-basemaps]
import { migrate, pool, withTransaction } from '../db.js';
import { ensureDataDirs, writeWikiRevision } from './files.js';
import { syncEntities, syncWikiPage } from './sync.js';

async function main() {
  const exclude = process.argv.find((a) => a.startsWith('--exclude-source='))?.split('=')[1] ?? null;
  await ensureDataDirs();
  await migrate((msg) => console.log(msg));

  await withTransaction(async (client) => {
    const { rows: entities } = await client.query<{ id: number }>(
      'SELECT id FROM entities WHERE $1::text IS NULL OR source IS DISTINCT FROM $1 ORDER BY id',
      [exclude],
    );
    // Les liens vers les éléments exclus sont retirés pour que les fichiers restent cohérents.
    if (exclude) {
      await client.query(
        'DELETE FROM entity_wiki_links l USING entities e WHERE e.id = l.entity_id AND e.source = $1',
        [exclude],
      );
    }
    await syncEntities(client, entities.map((e) => e.id));

    const { rows: pages } = await client.query<{ id: number; slug: string }>('SELECT id, slug FROM wiki_pages');
    for (const page of pages) {
      await syncWikiPage(client, page.slug, false);
      const { rows: revs } = await client.query<{ title: string; content: string; created_at: Date }>(
        'SELECT title, content, created_at FROM wiki_revisions WHERE page_id = $1',
        [page.id],
      );
      for (const r of revs) await writeWikiRevision(page.slug, { title: r.title, content: r.content, createdAt: r.created_at });
    }
    console.log(`${entities.length} éléments et ${pages.length} pages écrits dans le dossier de données.`);
    // Rien ne doit être modifié dans l'ancienne base.
    throw new RollbackSignal();
  }).catch((err) => {
    if (!(err instanceof RollbackSignal)) throw err;
  });
}

class RollbackSignal extends Error {}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
