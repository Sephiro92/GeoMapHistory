import { useState } from 'react';
import type { EntityInput, Kind } from '../api';
import { LinkPicker, type PickItem } from '../components/LinkPicker';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { YearInput } from '../components/YearInput';
import { searchWikiPages } from './pickers';

export interface CreateInput extends EntityInput {
  startYear: number;
  endYear: number | null;
  wikiPageIds: number[];
}

interface Props {
  kind: Kind;
  year: number;
  hasGeometry: boolean;
  onSave: (input: CreateInput) => Promise<void>;
  onCancel: () => void;
}

export function CreatePanel({ kind, year, hasGeometry, onSave, onCancel }: Props) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [color, setColor] = useState(kind === 'point' ? '#a0442c' : '#7a5c2e');
  const [description, setDescription] = useState('');
  const [startYear, setStartYear] = useState<number | null>(year);
  const [endYear, setEndYear] = useState<number | null>(null);
  const [singleYear, setSingleYear] = useState(false);
  const [pages, setPages] = useState<PickItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (startYear === null) return setError("L'année de début est obligatoire");
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name,
        category,
        color,
        description,
        startYear,
        endYear: singleYear ? startYear : endYear,
        wikiPageIds: pages.map((p) => p.id),
      });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <aside className="panel">
      <header className="panel__header">
        <h2>{kind === 'point' ? 'Nouveau point' : 'Nouvelle zone'}</h2>
        <button className="icon-button" onClick={onCancel} title="Annuler">
          ×
        </button>
      </header>
      <form className="form" onSubmit={submit}>
        {!hasGeometry && (
          <p className="hint">
            {kind === 'point'
              ? 'Cliquez sur la carte pour placer le point.'
              : 'Cliquez sur la carte pour tracer la zone, puis cliquez sur le premier sommet (ou Entrée) pour la fermer.'}
          </p>
        )}
        <label>
          Nom
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <div className="row">
          <label>
            Catégorie
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="ex : bataille, ville…" />
          </label>
          <label>
            Couleur
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <label>
            Début
            <YearInput value={startYear} onChange={setStartYear} />
          </label>
          {!singleYear && (
            <label>
              Fin
              <YearInput value={endYear} onChange={setEndYear} allowEmpty emptyLabel="sans fin" />
            </label>
          )}
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={singleYear} onChange={(e) => setSingleYear(e.target.checked)} />
          Événement ponctuel (visible uniquement l'année de début)
        </label>
        <label>Infobulle (Markdown)</label>
        <MarkdownEditor value={description} onChange={setDescription} rows={5} />
        <label>Pages du wiki liées</label>
        <LinkPicker selected={pages} onChange={setPages} search={searchWikiPages} />
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={!hasGeometry || saving || !name.trim()}>
            {saving ? 'Enregistrement…' : 'Créer'}
          </button>
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
        </div>
      </form>
    </aside>
  );
}
