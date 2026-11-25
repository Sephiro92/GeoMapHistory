import { useEffect, useState } from 'react';

export interface PickItem {
  id: number;
  label: string;
}

interface Props {
  selected: PickItem[];
  onChange: (items: PickItem[]) => void;
  search: (query: string) => Promise<PickItem[]>;
  placeholder?: string;
}

/** Liste de liens sélectionnés (puces) + recherche pour en ajouter. */
export function LinkPicker({ selected, onChange, search, placeholder = 'Rechercher…' }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      search(query)
        .then(setResults)
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query, open, search]);

  const selectedIds = new Set(selected.map((s) => s.id));

  return (
    <div className="link-picker">
      <div className="chips">
        {selected.map((item) => (
          <span key={item.id} className="chip">
            {item.label}
            <button type="button" onClick={() => onChange(selected.filter((s) => s.id !== item.id))} title="Retirer">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="link-picker__search">
        <input
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setQuery(e.target.value)}
        />
        {open && results.length > 0 && (
          <ul className="link-picker__results">
            {results
              .filter((r) => !selectedIds.has(r.id))
              .slice(0, 12)
              .map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange([...selected, r]);
                      setQuery('');
                    }}
                  >
                    {r.label}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
