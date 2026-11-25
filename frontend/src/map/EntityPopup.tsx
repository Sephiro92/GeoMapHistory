import maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api, type Entity } from '../api';
import { Markdown } from '../components/Markdown';
import { formatPeriod } from '../years';

interface Props {
  map: maplibregl.Map;
  lngLat: [number, number];
  entityId: number;
  versionId: number;
  reloadKey: number;
  onClose: () => void;
  onDetails: (entityId: number) => void;
}

/** Infobulle affichée au clic sur un point ou une zone. */
export function EntityPopup({ map, lngLat, entityId, versionId, reloadKey, onClose, onDetails }: Props) {
  const [container] = useState(() => document.createElement('div'));
  const [entity, setEntity] = useState<Entity | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const popup = new maplibregl.Popup({ maxWidth: '360px', closeOnClick: false, className: 'entity-popup' })
      .setLngLat(lngLat)
      .setDOMContent(container)
      .addTo(map);
    const handleClose = () => onCloseRef.current();
    popup.on('close', handleClose);
    return () => {
      popup.off('close', handleClose);
      popup.remove();
    };
  }, [map, lngLat, container]);

  useEffect(() => {
    let cancelled = false;
    api
      .entity(entityId)
      .then((e) => !cancelled && setEntity(e))
      .catch(() => !cancelled && setEntity(null));
    return () => {
      cancelled = true;
    };
  }, [entityId, reloadKey]);

  const version = entity?.versions.find((v) => v.id === versionId) ?? entity?.versions[0];

  return createPortal(
    entity && version ? (
      <div className="popup">
        <h3>
          <span className="swatch" style={{ background: entity.color }} />
          {version.label || entity.name}
        </h3>
        <p className="muted">
          {formatPeriod(version.startYear, version.endYear)}
          {entity.category && ` · ${entity.category}`}
        </p>
        {entity.description && (
          <div className="popup__description">
            <Markdown source={entity.description} />
          </div>
        )}
        {entity.wikiPages.length > 0 && (
          <ul className="popup__links">
            {entity.wikiPages.map((p) => (
              <li key={p.id}>
                📖 <Link to={`/wiki/${p.slug}`}>{p.title}</Link>
              </li>
            ))}
          </ul>
        )}
        <button className="link-button" onClick={() => onDetails(entity.id)}>
          Fiche détaillée →
        </button>
      </div>
    ) : (
      <p className="muted">Chargement…</p>
    ),
    container,
  );
}
