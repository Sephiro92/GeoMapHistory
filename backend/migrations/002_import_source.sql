-- Origine d'une entité importée (NULL = créée à la main), pour pouvoir ré-importer proprement.
ALTER TABLE entities ADD COLUMN source TEXT;
CREATE INDEX entities_source_idx ON entities (source);

-- Comble les trous des polygones (l'outil de dessin ne sait pas éditer les polygones à trous).
-- Le résultat est une union valide des contours extérieurs.
CREATE FUNCTION geomap_fill_holes(g geometry) RETURNS geometry
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT ST_Multi(ST_Union(ST_MakePolygon(ST_ExteriorRing(d.geom))))
  FROM ST_Dump(ST_CollectionExtract(g, 3)) AS d
$$;
