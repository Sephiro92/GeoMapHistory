import { useEffect, useState } from 'react';
import { formatYear, MAX_YEAR, MIN_YEAR, parseYear } from '../years';

interface Props {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Autorise la valeur vide (ex : pas d'année de fin). */
  allowEmpty?: boolean;
  emptyLabel?: string;
}

/** Saisie d'une année : négatif = av. J.-C. ; l'an 0 est refusé. */
export function YearInput({ value, onChange, allowEmpty = false, emptyLabel = 'aucune' }: Props) {
  const [text, setText] = useState(value === null ? '' : String(value));

  useEffect(() => {
    if (parseYear(text) !== value) setText(value === null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const parsed = parseYear(text);
  const invalid = text.trim() !== '' && parsed === null;

  return (
    <span className="year-input">
      <input
        type="number"
        min={MIN_YEAR}
        max={MAX_YEAR}
        value={text}
        placeholder={allowEmpty ? emptyLabel : ''}
        className={invalid ? 'invalid' : ''}
        onChange={(e) => {
          setText(e.target.value);
          const y = parseYear(e.target.value);
          if (y !== null) onChange(y);
          else if (allowEmpty && e.target.value.trim() === '') onChange(null);
        }}
      />
      <small>{invalid ? 'année invalide' : parsed !== null ? formatYear(parsed) : allowEmpty ? emptyLabel : ''}</small>
    </span>
  );
}
