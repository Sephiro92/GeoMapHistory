import type { Position } from 'geojson';
import maplibregl, { type GeoJSONSource, type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TerraDraw } from 'terra-draw';
import { api, isAbort, type Entity, type EntityGeometry, type Kind, type Version } from '../api';
import { useAuth } from '../auth';
import { DEFAULT_YEAR, parseYear } from '../years';
import {
  buildStyle,
  CLICKABLE_LAYERS,
  FEATURE_LAYERS,
  FEATURES_SOURCE,
  kindFilter,
  layerKind,
  ZONE_LABELS_SOURCE,
} from './basemap';
import { CreatePanel, type CreateInput } from './CreatePanel';
import { collectGeometry, createDraw, loadGeometry } from './draw';
import { EntityPanel } from './EntityPanel';
import { EntityPopup } from './EntityPopup';
import { Timeline } from './Timeline';

type Session =
  | { type: 'create'; kind: Kind; drawn: boolean }
  | { type: 'geometry'; kind: Kind; entityId: number; versionId: number; name: string };

interface PopupState {
  lngLat: [number, number];
  entityId: number;
  versionId: number;
}

function geometryBounds(geometry: EntityGeometry): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  const visit = (c: unknown): void => {
    if (typeof (c as Position)[0] === 'number') bounds.extend(c as [number, number]);
    else (c as unknown[]).forEach(visit);
  };
  visit(geometry.coordinates);
  return bounds;
}

export function MapPage() {
  const { admin } = useAuth();
  const [params, setParams] = useSearchParams();
  const year = parseYear(params.get('year')) ?? DEFAULT_YEAR;
  const focusEntity = Number(params.get('entity')) || null;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [panelEntityId, setPanelEntityId] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const setYear = useCallback(
    (y: number) =>
      setParams(
        (p) => {
          p.set('year', String(y));
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );

  // Cadrage appelé quand la fiche est ouverte : on réserve sa place à droite et celle de la frise en bas.
  const fitGeometry = useCallback((geometry: EntityGeometry) => {
    const map = mapRef.current;
    if (!map) return;
    const padding = { top: 70, bottom: 170, left: 60, right: 460 };
    if (geometry.type === 'Point') {
      map.flyTo({ center: geometry.coordinates as [number, number], zoom: Math.max(map.getZoom(), 5), padding });
    } else {
      map.fitBounds(geometryBounds(geometry), { padding, maxZoom: 6 });
    }
  }, []);

  // Création de la carte et de l'outil de dessin.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: buildStyle(),
      center: [20, 35],
      zoom: 2.2,
      renderWorldCopies: false,
      attributionControl: { compact: true, customAttribution: 'Fond : Natural Earth' },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    mapRef.current = map;

    let hoveredId: string | number | undefined;
    const setHover = (id: string | number | undefined) => {
      if (hoveredId !== undefined) map.setFeatureState({ source: FEATURES_SOURCE, id: hoveredId }, { hover: false });
      hoveredId = id;
      if (id !== undefined) map.setFeatureState({ source: FEATURES_SOURCE, id }, { hover: true });
    };

    const hitAt = (point: maplibregl.PointLike): MapGeoJSONFeature | undefined =>
      map.queryRenderedFeatures(point, { layers: CLICKABLE_LAYERS })[0];

    map.on('mousemove', (e) => {
      if (sessionRef.current) return;
      const hit = hitAt(e.point);
      map.getCanvas().style.cursor = hit ? 'pointer' : '';
      if (hit?.id !== hoveredId) setHover(hit?.id);
    });

    map.on('click', (e) => {
      if (sessionRef.current) return;
      const hit = hitAt(e.point);
      if (!hit) return setPopup(null);
      setPopup({
        lngLat: [e.lngLat.lng, e.lngLat.lat],
        entityId: hit.properties.entityId,
        versionId: hit.properties.versionId,
      });
    });

    map.on('load', () => {
      const draw = createDraw(map);
      draw.on('finish', (_id, context) => {
        const current = sessionRef.current;
        if (!current || (context.mode !== 'point' && context.mode !== 'polygon')) return;
        draw.setMode('select');
        if (current.type === 'create') setSession({ ...current, drawn: true });
      });
      drawRef.current = draw;
      setMapReady(true);
    });

    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Chargement des éléments valides à l'année affichée.
  useEffect(() => {
    if (!mapReady) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .features(year, controller.signal)
        .then((fc) => {
          const map = mapRef.current;
          if (!map) return;
          (map.getSource(FEATURES_SOURCE) as GeoJSONSource).setData(fc);
          (map.getSource(ZONE_LABELS_SOURCE) as GeoJSONSource).setData({
            type: 'FeatureCollection',
            features: fc.features
              .filter((f) => f.properties.labelAt)
              .map((f) => ({
                type: 'Feature',
                properties: f.properties,
                geometry: { type: 'Point', coordinates: f.properties.labelAt! },
              })),
          });
        })
        .catch((err) => !isAbort(err) && setMessage(err.message));
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [year, reloadKey, mapReady]);

  // Pendant l'édition d'une géométrie, on masque la version d'origine.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const hiddenId = session?.type === 'geometry' ? session.versionId : -1;
    for (const layer of FEATURE_LAYERS) {
      map.setFilter(layer, ['all', kindFilter(layerKind(layer)), ['!=', ['get', 'versionId'], hiddenId]]);
    }
  }, [session, mapReady]);

  // Lien entrant (?entity=12) depuis le wiki : on se place sur l'élément.
  useEffect(() => {
    if (!mapReady || !focusEntity) return;
    api
      .entity(focusEntity)
      .then((entity) => {
        // On garde l'année affichée si l'élément y existe, sinon on saute à sa première apparition.
        const atYear = entity.versions.find((v) => v.startYear <= year && (v.endYear === null || v.endYear >= year));
        const version = atYear ?? entity.versions[0];
        setParams(
          (p) => {
            p.delete('entity');
            if (!atYear && version) p.set('year', String(version.startYear));
            return p;
          },
          { replace: true },
        );
        if (version) fitGeometry(version.geometry);
        setPanelEntityId(entity.id);
      })
      .catch((err) => setMessage(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, focusEntity]);

  const endSession = useCallback(() => {
    const draw = drawRef.current;
    if (draw) {
      draw.clear();
      draw.setMode('static');
    }
    setSession(null);
  }, []);

  function startCreate(kind: Kind) {
    const draw = drawRef.current;
    if (!draw) return;
    setPopup(null);
    setPanelEntityId(null);
    draw.clear();
    draw.setMode(kind === 'point' ? 'point' : 'polygon');
    setSession({ type: 'create', kind, drawn: false });
  }

  function startGeometryEdit(entity: Entity, version: Version) {
    const draw = drawRef.current;
    if (!draw) return;
    setPopup(null);
    draw.clear();
    const error = loadGeometry(draw, version.geometry);
    if (error) {
      draw.clear();
      setMessage(`Cette géométrie ne peut pas être éditée : ${error}`);
      return;
    }
    draw.setMode('select');
    setYear(version.startYear);
    fitGeometry(version.geometry);
    setSession({ type: 'geometry', kind: entity.kind, entityId: entity.id, versionId: version.id, name: entity.name });
  }

  function addPart() {
    drawRef.current?.setMode('polygon');
  }

  async function saveCreate(input: CreateInput) {
    if (session?.type !== 'create' || !drawRef.current) return;
    const geometry = collectGeometry(drawRef.current, session.kind);
    if (!geometry) throw new Error('Rien n’a été dessiné');
    const entity = await api.createEntity({
      kind: session.kind,
      name: input.name,
      description: input.description,
      color: input.color,
      category: input.category,
      wikiPageIds: input.wikiPageIds,
      version: { startYear: input.startYear, endYear: input.endYear, geometry },
    });
    endSession();
    reload();
    setPanelEntityId(entity.id);
  }

  async function saveGeometry() {
    if (session?.type !== 'geometry' || !drawRef.current) return;
    const geometry = collectGeometry(drawRef.current, session.kind);
    if (!geometry) return setMessage('Rien à enregistrer : la géométrie est vide');
    try {
      await api.updateVersion(session.versionId, { geometry });
      endSession();
      reload();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  const panelOpen = session?.type === 'create' || panelEntityId !== null;

  return (
    <div className={`map-page ${panelOpen ? 'has-panel' : ''}`}>
      <div ref={containerRef} className="map" />

      {admin && !session && (
        <div className="map-toolbar">
          <button onClick={() => startCreate('point')}>＋ Point</button>
          <button onClick={() => startCreate('zone')}>＋ Zone</button>
        </div>
      )}

      {session && (session.type === 'geometry' || session.drawn) && (
        <div className="map-toolbar map-toolbar--session">
          <span>
            {session.type === 'geometry' ? `Géométrie de « ${session.name} »` : 'Ajustez le tracé'} — déplacez les
            sommets, Suppr. pour effacer l'élément sélectionné.
          </span>
          {session.kind === 'zone' && <button onClick={addPart}>＋ Ajouter une partie</button>}
          {session.type === 'geometry' && (
            <>
              <button className="primary" onClick={saveGeometry}>
                Enregistrer
              </button>
              <button onClick={endSession}>Annuler</button>
            </>
          )}
        </div>
      )}

      {message && (
        <div className="toast" onClick={() => setMessage(null)}>
          {message} <span className="muted">(cliquer pour fermer)</span>
        </div>
      )}

      {mapReady && popup && mapRef.current && (
        <EntityPopup
          map={mapRef.current}
          lngLat={popup.lngLat}
          entityId={popup.entityId}
          versionId={popup.versionId}
          reloadKey={reloadKey}
          onClose={() => setPopup(null)}
          onDetails={(id) => {
            setPopup(null);
            setPanelEntityId(id);
          }}
        />
      )}

      {session?.type === 'create' ? (
        <CreatePanel
          kind={session.kind}
          year={year}
          hasGeometry={session.drawn}
          onSave={saveCreate}
          onCancel={endSession}
        />
      ) : (
        panelEntityId !== null && (
          <EntityPanel
            entityId={panelEntityId}
            year={year}
            admin={admin}
            reloadKey={reloadKey}
            onClose={() => setPanelEntityId(null)}
            onChanged={reload}
            onGoTo={(v) => {
              setYear(v.startYear);
              fitGeometry(v.geometry);
            }}
            onEditGeometry={startGeometryEdit}
          />
        )
      )}

      <Timeline year={year} onChange={setYear} />
    </div>
  );
}
