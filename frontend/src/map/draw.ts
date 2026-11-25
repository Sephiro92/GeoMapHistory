import type { Map as MapLibreMap } from 'maplibre-gl';
import { TerraDraw, TerraDrawPointMode, TerraDrawPolygonMode, TerraDrawSelectMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { Point, Polygon, Position } from 'geojson';
import type { EntityGeometry, Kind } from '../api';

const DRAW_COLOR = '#1f4e79';

export function createDraw(map: MapLibreMap): TerraDraw {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawPointMode({
        styles: { pointColor: DRAW_COLOR, pointWidth: 7, pointOutlineColor: '#ffffff', pointOutlineWidth: 2 },
      }),
      new TerraDrawPolygonMode({
        styles: { fillColor: DRAW_COLOR, fillOpacity: 0.25, outlineColor: DRAW_COLOR, outlineWidth: 2 },
      }),
      new TerraDrawSelectMode({
        flags: {
          point: { feature: { draggable: true } },
          polygon: {
            feature: {
              draggable: true,
              coordinates: { midpoints: true, draggable: true, deletable: true },
            },
          },
        },
      }),
    ],
  });
  draw.start();
  return draw;
}

/** Charge une géométrie existante dans l'outil de dessin (une MultiPolygon devient plusieurs polygones). */
export function loadGeometry(draw: TerraDraw, geometry: EntityGeometry): string | null {
  const parts: (Point | Polygon)[] =
    geometry.type === 'MultiPolygon'
      ? geometry.coordinates.map((coordinates): Polygon => ({ type: 'Polygon', coordinates }))
      : [geometry];
  const results = draw.addFeatures(
    parts.map((g) => ({
      id: crypto.randomUUID(),
      type: 'Feature',
      geometry: g,
      properties: { mode: g.type === 'Point' ? 'point' : 'polygon' },
    })),
  );
  const invalid = results.find((r) => !r.valid);
  return invalid ? (invalid.reason ?? 'géométrie non éditable') : null;
}

/** Reconstruit la géométrie à enregistrer à partir de ce qui est dessiné. */
export function collectGeometry(draw: TerraDraw, kind: Kind): EntityGeometry | null {
  const snapshot = draw.getSnapshot();
  if (kind === 'point') {
    const points = snapshot.filter((f) => f.geometry.type === 'Point');
    const last = points[points.length - 1];
    return last ? { type: 'Point', coordinates: last.geometry.coordinates as Position } : null;
  }
  const polygons = snapshot
    .filter((f) => f.geometry.type === 'Polygon')
    .map((f) => f.geometry.coordinates as Position[][]);
  if (polygons.length === 0) return null;
  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  return { type: 'MultiPolygon', coordinates: polygons };
}
