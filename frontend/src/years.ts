// Années historiques : -753 = 753 av. J.-C., pas d'an 0.
// Pour les calculs, on passe par la numérotation astronomique (1 av. J.-C. = 0).

export const MIN_YEAR = -3000;
export const MAX_YEAR = 2100;
export const DEFAULT_YEAR = 1;

export const toAstro = (year: number) => (year < 0 ? year + 1 : year);
export const fromAstro = (astro: number) => (astro <= 0 ? astro - 1 : astro);

export function clampYear(year: number): number {
  if (year === 0) year = 1;
  return Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.trunc(year)));
}

export const addYears = (year: number, n: number) => clampYear(fromAstro(toAstro(year) + n));

export function formatYear(year: number): string {
  return year < 0 ? `${-year} av. J.-C.` : String(year);
}

export function formatPeriod(start: number, end: number | null): string {
  if (end === null) return `depuis ${formatYear(start)}`;
  if (start === end) return formatYear(start);
  return `${formatYear(start)} – ${formatYear(end)}`;
}

export function parseYear(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n === 0 || n < MIN_YEAR || n > MAX_YEAR) return null;
  return n;
}

/** Même règle que slugify() côté backend, pour que les liens [[Titre]] tombent juste. */
export function slugify(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'page'
  );
}
