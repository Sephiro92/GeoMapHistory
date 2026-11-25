import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { slugify } from '../years';

const encode = (s: string) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29');

/**
 * Syntaxe de liens internes :
 *   [[Titre de page]] ou [[Titre de page|texte]]  → page du wiki
 *   [[carte:12]] ou [[carte:12|texte]]           → élément n°12 sur la carte
 */
export function expandInternalLinks(src: string): string {
  return src.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => {
    const t = target.trim();
    const map = /^carte:(\d+)$/i.exec(t);
    if (map) return `[${label ?? 'voir sur la carte'}](/?entity=${map[1]})`;
    return `[${label ?? t}](/wiki/${slugify(t)}?t=${encode(t)})`;
  });
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href && href.startsWith('/') && !href.startsWith('/uploads/') ? (
              <Link to={href}>{children}</Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {expandInternalLinks(source)}
      </ReactMarkdown>
    </div>
  );
}
