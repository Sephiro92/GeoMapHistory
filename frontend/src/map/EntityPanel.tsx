import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Entity, type Version } from '../api';
import { LinkPicker, type PickItem } from '../components/LinkPicker';
import { Markdown } from '../components/Markdown';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { YearInput } from '../components/YearInput';
import { addYears, formatPeriod, formatYear } from '../years';
import { searchWikiPages } from './pickers';

interface Props {
  entityId: number;
  year: number;
  admin: boolean;
  reloadKey: number;
  onClose: () => void;
  onChanged: () => void;
  onGoTo: (version: Version) => void;
  onEditGeometry: (entity: Entity, version: Version) => void;
}

const covers = (v: Version, year: number) => v.startYear <= year && (v.endYear === null || v.endYear >= year);

/** Fiche détaillée d'un élément de la carte, avec l'édition pour l'admin. */
export function EntityPanel({ entityId, year, admin, reloadKey, onClose, onChanged, onGoTo, onEditGeometry }: Props) {
  const [entity, setEntity] = useState<Entity | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api
      .entity(entityId)
      .then(setEntity)
      .catch((err) => setError(err.message));
  }, [entityId, reloadKey]);

  if (!entity) {
    return (
      <aside className="panel">
        <header className="panel__header">
          <h2>…</h2>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </header>
        {error ? <p className="error">{error}</p> : <p className="muted">Chargement…</p>}
      </aside>
    );
  }

  /** Applique une modification et rafraîchit la fiche et la carte. */
  async function run(action: () => Promise<Entity | void>) {
    setError(null);
    try {
      const updated = await action();
      if (updated) setEntity(updated);
      onChanged();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function remove() {
    if (!confirm(`Supprimer définitivement « ${entity!.name} » et toutes ses versions ?`)) return;
    if (await run(() => api.deleteEntity(entity!.id))) onClose();
  }

  // Termine la version courante l'année précédente et en crée une nouvelle avec la même géométrie,
  // prête à être retouchée (ex : nouvelles frontières d'un empire).
  async function splitVersion(source: Version, startYear: number) {
    if (startYear <= source.startYear) {
      setError(`La nouvelle version doit commencer après ${formatYear(source.startYear)}`);
      return;
    }
    const oldEnd = source.endYear;
    if (oldEnd !== null && startYear > oldEnd) {
      setError('Cette année est en dehors de la période de la version');
      return;
    }
    const ok = await run(async () => {
      await api.updateVersion(source.id, { endYear: addYears(startYear, -1) });
      return api.addVersion(entity!.id, {
        startYear,
        endYear: oldEnd,
        label: source.label,
        geometry: source.geometry,
      });
    });
    if (ok) {
      const fresh = await api.entity(entity!.id);
      const created = fresh.versions.find((v) => v.startYear === startYear);
      if (created) onEditGeometry(fresh, created);
    }
  }

  return (
    <aside className="panel">
      <header className="panel__header">
        <h2>
          <span className="swatch" style={{ background: entity.color }} />
          {entity.name}
        </h2>
        <button className="icon-button" onClick={onClose} title="Fermer">
          ×
        </button>
      </header>
      <p className="muted">
        {entity.kind === 'point' ? 'Point' : 'Zone'}
        {entity.category && ` · ${entity.category}`}
      </p>
      {error && <p className="error">{error}</p>}

      {editing ? (
        <EntityForm
          entity={entity}
          onCancel={() => setEditing(false)}
          onSave={async (fields, pageIds) => {
            const ok = await run(async () => {
              await api.updateEntity(entity.id, fields);
              return api.setEntityWikiLinks(entity.id, pageIds);
            });
            if (ok) setEditing(false);
          }}
        />
      ) : (
        <>
          {entity.description ? <Markdown source={entity.description} /> : <p className="muted">Pas de description.</p>}
          {entity.wikiPages.length > 0 && (
            <section>
              <h3>Wiki</h3>
              <ul>
                {entity.wikiPages.map((p) => (
                  <li key={p.id}>
                    <Link to={`/wiki/${p.slug}`}>{p.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {admin && (
            <div className="actions">
              <button onClick={() => setEditing(true)}>Modifier</button>
              <button className="danger" onClick={remove}>
                Supprimer
              </button>
            </div>
          )}
        </>
      )}

      <section>
        <h3>Versions dans le temps</h3>
        <ul className="versions">
          {entity.versions.map((v) => (
            <VersionRow
              key={v.id}
              version={v}
              active={covers(v, year)}
              admin={admin}
              year={year}
              canDelete={entity.versions.length > 1}
              onGoTo={() => onGoTo(v)}
              onEditGeometry={() => onEditGeometry(entity, v)}
              onSave={(patch) => run(() => api.updateVersion(v.id, patch))}
              onDelete={() => confirm('Supprimer cette version ?') && run(() => api.deleteVersion(v.id))}
              onSplit={(startYear) => splitVersion(v, startYear)}
            />
          ))}
        </ul>
      </section>
    </aside>
  );
}

function EntityForm({
  entity,
  onSave,
  onCancel,
}: {
  entity: Entity;
  onSave: (fields: { name: string; category: string; color: string; description: string }, pageIds: number[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(entity.name);
  const [category, setCategory] = useState(entity.category);
  const [color, setColor] = useState(entity.color);
  const [description, setDescription] = useState(entity.description);
  const [pages, setPages] = useState<PickItem[]>(entity.wikiPages.map((p) => ({ id: p.id, label: p.title })));

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, category, color, description }, pages.map((p) => p.id));
      }}
    >
      <label>
        Nom
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <div className="row">
        <label>
          Catégorie
          <input value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>
        <label>
          Couleur
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
      </div>
      <label>Infobulle (Markdown)</label>
      <MarkdownEditor value={description} onChange={setDescription} rows={6} />
      <label>Pages du wiki liées</label>
      <LinkPicker selected={pages} onChange={setPages} search={searchWikiPages} />
      <div className="actions">
        <button type="submit" className="primary">
          Enregistrer
        </button>
        <button type="button" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}

interface VersionRowProps {
  version: Version;
  active: boolean;
  admin: boolean;
  year: number;
  canDelete: boolean;
  onGoTo: () => void;
  onEditGeometry: () => void;
  onSave: (patch: { startYear: number; endYear: number | null; label: string | null }) => void;
  onDelete: () => void;
  onSplit: (startYear: number) => void;
}

function VersionRow(props: VersionRowProps) {
  const { version, active, admin, year } = props;
  const [editing, setEditing] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [startYear, setStartYear] = useState<number | null>(version.startYear);
  const [endYear, setEndYear] = useState<number | null>(version.endYear);
  const [label, setLabel] = useState(version.label ?? '');
  const [splitYear, setSplitYear] = useState<number | null>(year);

  return (
    <li className={`version ${active ? 'version--active' : ''}`}>
      <div className="version__summary">
        <button className="link-button" onClick={props.onGoTo} title="Afficher sur la carte à cette période">
          {formatPeriod(version.startYear, version.endYear)}
        </button>
        {version.label && <span className="muted"> · {version.label}</span>}
        {version.geometry.type === 'MultiPolygon' && (
          <span className="muted"> · {version.geometry.coordinates.length} parties</span>
        )}
      </div>
      {admin && !editing && !splitting && (
        <div className="version__actions">
          <button onClick={() => setEditing(true)}>Dates</button>
          <button onClick={props.onEditGeometry}>Géométrie</button>
          <button onClick={() => setSplitting(true)} title="Créer une nouvelle version à partir d'une année">
            Nouvelle version
          </button>
          {props.canDelete && (
            <button className="danger" onClick={props.onDelete}>
              Suppr.
            </button>
          )}
        </div>
      )}
      {editing && (
        <form
          className="form form--compact"
          onSubmit={(e) => {
            e.preventDefault();
            if (startYear === null) return;
            props.onSave({ startYear, endYear, label: label.trim() || null });
            setEditing(false);
          }}
        >
          <div className="row">
            <label>
              Début
              <YearInput value={startYear} onChange={setStartYear} />
            </label>
            <label>
              Fin
              <YearInput value={endYear} onChange={setEndYear} allowEmpty emptyLabel="sans fin" />
            </label>
          </div>
          <label>
            Nom pour cette période (optionnel)
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <div className="actions">
            <button type="submit" className="primary">
              OK
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Annuler
            </button>
          </div>
        </form>
      )}
      {splitting && (
        <form
          className="form form--compact"
          onSubmit={(e) => {
            e.preventDefault();
            if (splitYear === null) return;
            props.onSplit(splitYear);
            setSplitting(false);
          }}
        >
          <p className="hint">
            La version actuelle s'arrêtera l'année précédente ; la nouvelle reprend sa géométrie pour que vous la
            modifiiez.
          </p>
          <label>
            À partir de
            <YearInput value={splitYear} onChange={setSplitYear} />
          </label>
          <div className="actions">
            <button type="submit" className="primary">
              Créer
            </button>
            <button type="button" onClick={() => setSplitting(false)}>
              Annuler
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
