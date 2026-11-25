// Frontières historiques optionnelles, issues de historical-basemaps (A. Ourednik, licence GPL-3.0).
//
// Chaque fichier du dépôt est un instantané du monde à une année. Un territoire présent dans
// l'instantané d'une année est valide jusqu'à la veille de l'instantané suivant ; les instantanés
// consécutifs identiques sont fusionnés en une seule version.
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../errors.js';
import { MAX_YEAR } from '../validation.js';
import { removeEntityFile } from './files.js';
import { syncEntities } from './sync.js';

const REPO = 'aourednik/historical-basemaps';
const COMMIT = 'da7a4b735ecef70aebdc9c73e409d8a2500d50f3';
export const HISTORICAL_SOURCE = 'historical-basemaps';
const SIMPLIFY_TOLERANCE = 0.01; // en degrés, ~1 km

// Instantanés compris dans la frise (-3000 à 2100), en années historiques.
const SNAPSHOTS = [
  -3000, -2000, -1500, -1000, -700, -500, -400, -323, -300, -200, -100, -1, 100, 200, 300, 400, 500, 600, 700, 800,
  900, 1000, 1100, 1200, 1279, 1300, 1400, 1492, 1500, 1530, 1600, 1650, 1700, 1715, 1783, 1800, 1815, 1878, 1880,
  1900, 1914, 1920, 1930, 1938, 1945, 1960, 1994, 2000, 2010,
];

const PALETTE = [
  '#9c4f3d', '#7a5c2e', '#4f6d4a', '#3f6178', '#7b4f74', '#a07a2c', '#5b7d7a', '#8a5a44',
  '#566b2f', '#6d4c6e', '#2f5d62', '#9a6b3f', '#4a5a85', '#7f3f3f', '#6a7f45', '#8c6d8f',
];

const DESCRIPTION =
  '_Frontières issues de [historical-basemaps](https://github.com/aourednik/historical-basemaps) (GPL-3.0) ; ' +
  'leur précision varie selon les époques._';

const fileName = (year: number) => (year < 0 ? `world_bc${-year}.geojson` : `world_${year}.geojson`);
const previousYear = (year: number) => (year === 1 ? -1 : year - 1);

function colorFor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

async function download(year: number): Promise<unknown[]> {
  const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/geojson/${fileName(year)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  const data = (await res.json()) as { features?: unknown };
  if (!Array.isArray(data.features)) throw new Error(`Fichier inattendu : ${url}`);
  return data.features;
}

interface Snapshot {
  name: string;
  year: number;
  hash: string;
}

interface PlannedVersion {
  snapshotYear: number;
  startYear: number;
  endYear: number | null;
  lastIndex: number;
  hash: string;
}

/** Transforme la présence d'un territoire dans les instantanés en périodes de validité. */
function planVersions(snapshots: Snapshot[]): PlannedVersion[] {
  const versions: PlannedVersion[] = [];
  for (const s of snapshots) {
    const index = SNAPSHOTS.indexOf(s.year);
    const last = versions[versions.length - 1];
    if (last && last.hash === s.hash && last.lastIndex === index - 1) {
      last.lastIndex = index;
    } else {
      versions.push({ snapshotYear: s.year, startYear: s.year, endYear: null, lastIndex: index, hash: s.hash });
    }
  }
  for (const v of versions) {
    const next = SNAPSHOTS[v.lastIndex + 1];
    v.endYear = next === undefined ? null : Math.min(previousYear(next), MAX_YEAR);
  }
  return versions;
}

export async function countHistoricalBorders(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM entities WHERE source = $1', [
    HISTORICAL_SOURCE,
  ]);
  return rows[0].n;
}

export async function importHistoricalBorders(progress: (msg: string) => void) {
  if ((await countHistoricalBorders()) > 0) {
    throw new HttpError(409, 'Les frontières historiques sont déjà importées');
  }
  const createdIds: number[] = [];
  try {
    return await withTransaction(async (client) => {
      await client.query('CREATE TEMP TABLE hb_raw (year INT, name TEXT, geom geometry) ON COMMIT DROP');
      for (const [i, year] of SNAPSHOTS.entries()) {
        progress(`Téléchargement des cartes : ${i + 1} / ${SNAPSHOTS.length}`);
        await client.query(
          `INSERT INTO hb_raw (year, name, geom)
           SELECT $1, btrim(f->'properties'->>'NAME'),
                  ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(f->'geometry'), 4326))), 3)
           FROM json_array_elements($2::json) AS f
           WHERE f->'geometry' IS NOT NULL AND json_typeof(f->'geometry') = 'object'
             AND coalesce(btrim(f->'properties'->>'NAME'), '') <> ''`,
          [year, JSON.stringify(await download(year))],
        );
      }

      // Une géométrie par (année, nom) : union des morceaux, trous comblés, simplification.
      progress('Fusion et simplification des géométries…');
      await client.query(
        `CREATE TEMP TABLE hb_snap ON COMMIT DROP AS
         SELECT year, name, geom, md5(ST_AsBinary(geom)) AS hash
         FROM (
           SELECT year, name,
                  geomap_fill_holes(ST_MakeValid(ST_SimplifyPreserveTopology(
                    geomap_fill_holes(ST_Union(geom)), $1))) AS geom
           FROM hb_raw GROUP BY year, name
         ) s
         WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)`,
        [SIMPLIFY_TOLERANCE],
      );

      const { rows } = await client.query<Snapshot>('SELECT name, year, hash FROM hb_snap ORDER BY name, year');
      const byName = new Map<string, Snapshot[]>();
      for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);

      progress(`Création de ${byName.size} territoires…`);
      let versionCount = 0;
      for (const [name, snapshots] of byName) {
        const { rows: created } = await client.query<{ id: number }>(
          `INSERT INTO entities (kind, name, description, color, category, source)
           VALUES ('zone', $1, $2, $3, 'territoire', $4) RETURNING id`,
          [name, DESCRIPTION, colorFor(name), HISTORICAL_SOURCE],
        );
        createdIds.push(created[0].id);
        for (const v of planVersions(snapshots)) {
          // Un seul morceau -> Polygon simple, plus pratique à éditer.
          await client.query(
            `INSERT INTO entity_versions (entity_id, start_year, end_year, geom)
             SELECT $1, $2, $3, CASE WHEN ST_NumGeometries(geom) = 1 THEN ST_GeometryN(geom, 1) ELSE geom END
             FROM hb_snap WHERE name = $4 AND year = $5`,
            [created[0].id, v.startYear, v.endYear, name, v.snapshotYear],
          );
          versionCount++;
        }
      }

      await syncEntities(client, createdIds, (done) =>
        progress(`Écriture des fichiers : ${done} / ${createdIds.length}`),
      );
      return { entities: byName.size, versions: versionCount };
    });
  } catch (err) {
    // La transaction est annulée : on retire les fichiers déjà écrits.
    for (const id of createdIds) await removeEntityFile(id);
    throw err;
  }
}

/** Retire les territoires importés (y compris les modifications faites dessus). */
export async function removeHistoricalBorders(progress: (msg: string) => void): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>('DELETE FROM entities WHERE source = $1 RETURNING id', [
      HISTORICAL_SOURCE,
    ]);
    const ids = rows.map((r) => r.id);
    await syncEntities(client, ids, (done) => progress(`Suppression des fichiers : ${done} / ${ids.length}`));
    return ids.length;
  });
}
