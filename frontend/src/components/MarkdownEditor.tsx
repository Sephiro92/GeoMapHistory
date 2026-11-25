import { useRef, useState } from 'react';
import { api } from '../api';
import { Markdown } from './Markdown';

interface Props {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  /** Aperçu affiché à côté de l'éditeur plutôt que via un bouton. */
  sideBySide?: boolean;
}

export function MarkdownEditor({ value, onChange, rows = 8, sideBySide = false }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function insertAtCursor(text: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const media = await api.uploadMedia(file);
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '');
      insertAtCursor(`\n![${alt}](${media.url})\n`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const showPreview = sideBySide || preview;

  return (
    <div className={`md-editor ${sideBySide ? 'md-editor--split' : ''}`}>
      <div className="md-editor__toolbar">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? 'Envoi…' : '🖼 Image'}
        </button>
        <button type="button" onClick={() => insertAtCursor('[[Titre de page]]')} title="Lien vers une page du wiki">
          [[ ]] Lien wiki
        </button>
        {!sideBySide && (
          <button type="button" onClick={() => setPreview((p) => !p)}>
            {preview ? 'Éditer' : 'Aperçu'}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
          hidden
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="md-editor__body">
        {(sideBySide || !preview) && (
          <textarea ref={textareaRef} value={value} rows={rows} onChange={(e) => onChange(e.target.value)} />
        )}
        {showPreview && (
          <div className="md-editor__preview">
            <Markdown source={value || '*Rien à afficher*'} />
          </div>
        )}
      </div>
    </div>
  );
}
