import type { FeatureCollection, MultiLineString, Position } from 'geojson';
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import land50m from 'world-atlas/land-50m.json';

// Fond physique neutre (terres émergées Natural Earth, sans frontières modernes) embarqué dans l'app.
const topo = land50m as unknown as Topology<{ land: GeometryCollection }>;
const land = feature(topo, topo.objects.land);

function graticule(step: number): FeatureCollection<MultiLineString> {
  const lines: Position[][] = [];
  for (let lon = -180; lon <= 180; lon += step) {
    const line: Position[] = [];
    for (let lat = -80; lat <= 80; lat += 2) line.push([lon, lat]);
    lines.push(line);
  }
  for (let lat = -75; lat <= 75; lat += step) {
    const line: Position[] = [];
    for (let lon = -180; lon <= 180; lon += 2) line.push([lon, lat]);
    lines.push(line);
  }
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }],
  };
}

export const FEATURES_SOURCE = 'features';
export const ZONE_LABELS_SOURCE = 'zone-labels';
export const FEATURE_LAYERS = ['zones-fill', 'zones-outline', 'zones-label', 'points-circle', 'points-label'] as const;
export const CLICKABLE_LAYERS = ['points-circle', 'zones-fill'];

export const kindFilter = (kind: 'point' | 'zone'): ExpressionSpecification => ['==', ['get', 'kind'], kind];
export const layerKind = (layer: string) => (layer.startsWith('points') ? 'point' : 'zone');

const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
const LABEL_FONT = ['Open Sans Semibold'];

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    // Polices des étiquettes (seule ressource chargée depuis Internet).
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      land: { type: 'geojson', data: land },
      graticule: { type: 'geojson', data: graticule(15) },
      [FEATURES_SOURCE]: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'versionId',
      },
      // Une étiquette par zone (sinon MapLibre en place une par morceau de MultiPolygon).
      [ZONE_LABELS_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': '#c6d6da' } },
      { id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': '#a9bcc2', 'line-width': 0.5 } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#efe4cb' } },
      { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#a8977a', 'line-width': 0.7 } },
      {
        id: 'zones-fill',
        type: 'fill',
        source: FEATURES_SOURCE,
        filter: kindFilter('zone'),
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', hovered, 0.55, 0.35] },
      },
      {
        id: 'zones-outline',
        type: 'line',
        source: FEATURES_SOURCE,
        filter: kindFilter('zone'),
        paint: { 'line-color': ['get', 'color'], 'line-width': ['case', hovered, 2.5, 1.5] },
      },
      {
        id: 'zones-label',
        type: 'symbol',
        source: ZONE_LABELS_SOURCE,
        filter: kindFilter('zone'),
        layout: { 'text-field': ['get', 'name'], 'text-font': LABEL_FONT, 'text-size': 13, 'text-max-width': 8 },
        paint: { 'text-color': '#3b2f22', 'text-halo-color': 'rgba(255,255,255,0.8)', 'text-halo-width': 1.5 },
      },
      {
        id: 'points-circle',
        type: 'circle',
        source: FEATURES_SOURCE,
        filter: kindFilter('point'),
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['case', hovered, 8, 6],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      },
      {
        id: 'points-label',
        type: 'symbol',
        source: FEATURES_SOURCE,
        filter: kindFilter('point'),
        layout: {
          'text-field': ['get', 'name'],
          'text-font': LABEL_FONT,
          'text-size': 12,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': '#2b2b2b', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.5 },
      },
    ],
  };
}
