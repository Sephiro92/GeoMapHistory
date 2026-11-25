import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, type WikiPage } from '../api';
import { useAuth } from '../auth';
import { Markdown } from '../components/Markdown';
import { formatYear } from '../years';

export function WikiView() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const { admin } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState<WikiPage | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(null);
    setMissing(false);
    setError(null);
    api
      .wikiPage(slug)
      .then(setPage)
      .catch((err) => (err instanceof ApiError && err.status === 404 ? setMissing(true) : setError(err.message)));
  }, [slug]);

  if (missing) {
    const title = params.get('t') ?? slug;
    return (
      <main className="page">
        <h1>{title}</h1>
        <p className="muted">Cette page n'existe pas encore.</p>
        {admin && (
          <Link className="button primary" to={`/wiki/new?title=${encodeURIComponent(title)}`}>
            Créer la page
          </Link>
        )}
      </main>
    );
  }
  if (error) return <main className="page error">{error}</main>;
  if (!page) return <main className="page muted">Chargement…</main>;

  async function remove() {
    if (!confirm(`Supprimer définitivement la page « ${page!.title} » et son historique ?`)) return;
    try {
      await api.deleteWikiPage(page!.slug);
      navigate('/wiki');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="page wiki-page">
      <header className="page__header">
        <h1>{page.title}</h1>
        <div className="actions">
          <Link className="button" to={`/wiki/${page.slug}/history`}>
            Historique
          </Link>
          {admin && (
            <>
              <Link className="button primary" to={`/wiki/${page.slug}/edit`}>
                Modifier
              </Link>
              <button className="danger" onClick={remove}>
                Supprimer
              </button>
            </>
          )}
        </div>
      </header>
      <div className="wiki-page__layout">
        <article>
          <Markdown source={page.content} />
        </article>
        {page.entities.length > 0 && (
          <aside className="wiki-page__aside">
            <h3>Sur la carte</h3>
            <ul>
              {page.entities.map((e) => (
                <li key={e.id}>
                  <Link to={`/?entity=${e.id}${e.startYear !== null ? `&year=${e.startYear}` : ''}`}>
                    {e.kind === 'point' ? '📍' : '🗺'} {e.name}
                  </Link>
                  {e.startYear !== null && <span className="muted"> · {formatYear(e.startYear)}</span>}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
      <p className="muted small">Dernière modification : {new Date(page.updatedAt).toLocaleString('fr-FR')}</p>
    </main>
  );
}
