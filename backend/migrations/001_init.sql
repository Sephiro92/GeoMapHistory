CREATE EXTENSION IF NOT EXISTS postgis;

-- Les années sont des entiers signés en numérotation historique :
-- -753 = 753 av. J.-C., il n'y a pas d'an 0. Plage couverte : -3000 à 2100.

-- Une entité est un objet historique (ville, bataille, empire…) indépendant du temps.
CREATE TABLE entities (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('point', 'zone')),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#a0442c',
  category    TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une version porte la géométrie d'une entité sur une période (bornes incluses).
-- end_year NULL = toujours valide jusqu'à la fin de la frise.
CREATE TABLE entity_versions (
  id          SERIAL PRIMARY KEY,
  entity_id   INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  start_year  INT NOT NULL CHECK (start_year BETWEEN -3000 AND 2100 AND start_year <> 0),
  end_year    INT CHECK (end_year BETWEEN -3000 AND 2100 AND end_year <> 0),
  label       TEXT,
  geom        geometry(Geometry, 4326) NOT NULL,
  CHECK (end_year IS NULL OR end_year >= start_year)
);
CREATE INDEX entity_versions_entity_idx ON entity_versions (entity_id);
CREATE INDEX entity_versions_years_idx ON entity_versions (start_year, end_year);
CREATE INDEX entity_versions_geom_idx ON entity_versions USING GIST (geom);

CREATE TABLE wiki_pages (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chaque sauvegarde d'une page conserve une révision.
CREATE TABLE wiki_revisions (
  id          SERIAL PRIMARY KEY,
  page_id     INT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wiki_revisions_page_idx ON wiki_revisions (page_id, created_at DESC);

CREATE TABLE entity_wiki_links (
  entity_id   INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  page_id     INT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  PRIMARY KEY (entity_id, page_id)
);
CREATE INDEX entity_wiki_links_page_idx ON entity_wiki_links (page_id);

CREATE TABLE media (
  id            SERIAL PRIMARY KEY,
  filename      TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
