import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Revision } from '../api';
import { useAuth } from '../auth';
import { Markdown } from '../components/Markdown';

export function WikiHistory() {
  const { slug = '' } = useParams();
  const { admin } = useAuth();
  const navigate = useNavigate();
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selected, setSelected] = useState<Revision | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .revisions(slug)
      .then(setRevisions)
      .catch((err) => setError(err.message));
  }, [slug]);

  async function show(id: number) {
    try {
      setSelected(await api.revision(slug, id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function restore() {
    if (!selected) return;
    if (!confirm('Restaurer cette révision ? Elle deviendra la version courante.')) return;
    try {
      await api.updateWikiPage(slug, { title: selected.title, content: selected.content ?? '' });
      navigate(`/wiki/${slug}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="page page--wide">
      <header className="page__header">
        <h1>Historique</h1>
        <Link className="button" to={`/wiki/${slug}`}>
          Retour à la page
        </Link>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="history">
        <ul className="history__list">
          {revisions.map((r, i) => (
            <li key={r.id} className={selected?.id === r.id ? 'selected' : ''}>
              <button className="link-button" onClick={() => show(r.id)}>
                {new Date(r.createdAt).toLocaleString('fr-FR')}
              </button>
              {i === 0 && <span className="muted"> (actuelle)</span>}
              <div className="muted small">{r.title}</div>
            </li>
          ))}
        </ul>
        <div className="history__preview">
          {selected ? (
            <>
              {admin && (
                <button className="primary" onClick={restore}>
                  Restaurer cette révision
                </button>
              )}
              <h2>{selected.title}</h2>
              <Markdown source={selected.content ?? ''} />
            </>
          ) : (
            <p className="muted">Sélectionnez une révision.</p>
          )}
        </div>
      </div>
    </main>
  );
}
