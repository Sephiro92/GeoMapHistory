import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type WikiListItem } from '../api';
import { useAuth } from '../auth';

export function WikiList() {
  const { admin } = useAuth();
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState<WikiListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .wikiPages(query)
        .then(setPages)
        .catch((err) => setError(err.message));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <main className="page">
      <header className="page__header">
        <h1>Wiki</h1>
        {admin && (
          <Link className="button primary" to="/wiki/new">
            Nouvelle page
          </Link>
        )}
      </header>
      <input
        className="search"
        placeholder="Rechercher dans les titres et le contenu…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      {pages && pages.length === 0 && <p className="muted">Aucune page.</p>}
      <ul className="wiki-list">
        {pages?.map((p) => (
          <li key={p.id}>
            <Link to={`/wiki/${p.slug}`}>{p.title}</Link>
            <span className="muted"> · modifiée le {new Date(p.updatedAt).toLocaleDateString('fr-FR')}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
