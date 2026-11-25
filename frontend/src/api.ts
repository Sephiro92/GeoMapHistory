import type { FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';

export type Kind = 'point' | 'zone';
export type EntityGeometry = Point | Polygon | MultiPolygon;

export interface Version {
  id: number;
  startYear: number;
  endYear: number | null;
  label: string | null;
  geometry: EntityGeometry;
}

export interface WikiRef {
  id: number;
  slug: string;
  title: string;
}

export interface Entity {
  id: number;
  kind: Kind;
  name: string;
  description: string;
  color: string;
  category: string;
  versions: Version[];
  wikiPages: WikiRef[];
}

export interface EntitySummary {
  id: number;
  kind: Kind;
  name: string;
  category: string;
  startYear: number | null;
  endYear: number | null;
}

export interface FeatureProps {
  entityId: number;
  versionId: number;
  kind: Kind;
  name: string;
  color: string;
  category: string;
  startYear: number;
  endYear: number | null;
  labelAt: [number, number] | null;
}

export interface WikiPage {
  id: number;
  slug: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  entities: { id: number; name: string; kind: Kind; startYear: number | null }[];
}

export interface WikiListItem {
  id: number;
  slug: string;
  title: string;
  updatedAt: string;
}

export interface Revision {
  id: number;
  title: string;
  createdAt: string;
  content?: string;
}

export interface Media {
  id: number;
  url: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface EntityInput {
  name: string;
  description: string;
  color: string;
  category: string;
}

export interface VersionInput {
  startYear: number;
  endYear: number | null;
  label?: string | null;
  geometry: EntityGeometry;
}

export interface AdminJob {
  action: 'import' | 'remove';
  state: 'running' | 'done' | 'error';
  message: string;
  startedAt: string;
}

export interface HistoricalBordersStatus {
  imported: number;
  job: AdminJob | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method,
    signal,
    credentials: 'same-origin',
    headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => request<{ admin: boolean }>('GET', '/api/auth/me'),
  login: (username: string, password: string) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),

  features: (year: number, signal?: AbortSignal) =>
    request<FeatureCollection<EntityGeometry, FeatureProps>>('GET', `/api/features?year=${year}`, undefined, signal),
  entities: (search?: string) => request<EntitySummary[]>('GET', `/api/entities${q({ q: search })}`),
  entity: (id: number) => request<Entity>('GET', `/api/entities/${id}`),
  createEntity: (body: EntityInput & { kind: Kind; version: VersionInput; wikiPageIds: number[] }) =>
    request<Entity>('POST', '/api/entities', body),
  updateEntity: (id: number, body: Partial<EntityInput>) => request<Entity>('PATCH', `/api/entities/${id}`, body),
  deleteEntity: (id: number) => request<void>('DELETE', `/api/entities/${id}`),
  setEntityWikiLinks: (id: number, pageIds: number[]) =>
    request<Entity>('PUT', `/api/entities/${id}/wiki-links`, { pageIds }),
  addVersion: (entityId: number, body: VersionInput) =>
    request<Entity>('POST', `/api/entities/${entityId}/versions`, body),
  updateVersion: (id: number, body: Partial<VersionInput>) => request<Entity>('PATCH', `/api/versions/${id}`, body),
  deleteVersion: (id: number) => request<Entity>('DELETE', `/api/versions/${id}`),

  wikiPages: (search?: string) => request<WikiListItem[]>('GET', `/api/wiki${q({ q: search })}`),
  wikiPage: (slug: string) => request<WikiPage>('GET', `/api/wiki/${encodeURIComponent(slug)}`),
  createWikiPage: (body: { title: string; content: string; entityIds?: number[] }) =>
    request<WikiPage>('POST', '/api/wiki', body),
  updateWikiPage: (slug: string, body: { title: string; content: string; entityIds?: number[] }) =>
    request<WikiPage>('PUT', `/api/wiki/${encodeURIComponent(slug)}`, body),
  deleteWikiPage: (slug: string) => request<void>('DELETE', `/api/wiki/${encodeURIComponent(slug)}`),
  revisions: (slug: string) => request<Revision[]>('GET', `/api/wiki/${encodeURIComponent(slug)}/revisions`),
  revision: (slug: string, id: number) =>
    request<Revision>('GET', `/api/wiki/${encodeURIComponent(slug)}/revisions/${id}`),

  historicalBorders: () => request<HistoricalBordersStatus>('GET', '/api/admin/historical-borders'),
  importHistoricalBorders: () => request<AdminJob>('POST', '/api/admin/historical-borders'),
  removeHistoricalBorders: () => request<AdminJob>('DELETE', '/api/admin/historical-borders'),

  importContent: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ message: string }>('POST', '/api/admin/content', form);
  },

  uploadMedia: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<Media>('POST', '/api/media', form);
  },
};

export const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';
