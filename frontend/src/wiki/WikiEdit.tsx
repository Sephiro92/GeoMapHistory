import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { LinkPicker, type PickItem } from '../components/LinkPicker';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { searchEntities } from '../map/pickers';

/** Création (/wiki/new) ou modification (/wiki/:slug/edit) d'une page. */
export function WikiEdit() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { admin, ready } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState(params.get('title') ?? '');
  const [content, setContent] = useState('');
  const [entities, setEntities] = useState<PickItem[]>([]);
  const [loaded, setLoaded] = useState(!slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    api
      .wikiPage(slug)
      .then((page) => {
        setTitle(page.title);
        setContent(page.content);
        setEntities(page.entities.map((e) => ({ id: e.id, label: e.name })));
        setLoaded(true);
      })
      .catch((err) => setError(err.message));
  }, [slug]);

  if (ready && !admin) return <Navigate to="/login" replace />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { title, content, entityIds: entities.map((x) => x.id) };
      const page = slug ? await api.updateWikiPage(slug, body) : await api.createWikiPage(body);
      navigate(`/wiki/${page.slug}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <main className="page page--wide">
      <form className="form" onSubmit={save}>
        <header className="page__header">
          <h1>{slug ? 'Modifier la page' : 'Nouvelle page'}</h1>
          <div className="actions">
            <button type="submit" className="primary" disabled={saving || !loaded || !title.trim()}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <Link className="button" to={slug ? `/wiki/${slug}` : '/wiki'}>
              Annuler
            </Link>
          </div>
        </header>
        {error && <p className="error">{error}</p>}
        <label>
          Titre
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>Éléments de la carte liés</label>
        <LinkPicker selected={entities} onChange={setEntities} search={searchEntities} placeholder="Rechercher un point ou une zone…" />
        <label>Contenu (Markdown)</label>
        <p className="hint">
          Liens internes : <code>[[Titre de page]]</code>, <code>[[Titre|texte affiché]]</code>,{' '}
          <code>[[carte:12]]</code> pour l'élément n°12 de la carte.
        </p>
        <MarkdownEditor value={content} onChange={setContent} rows={24} sideBySide />
      </form>
    </main>
  );
}
