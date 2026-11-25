import { api } from '../api';
import type { PickItem } from '../components/LinkPicker';
import { formatPeriod } from '../years';

export const searchWikiPages = async (query: string): Promise<PickItem[]> =>
  (await api.wikiPages(query)).map((p) => ({ id: p.id, label: p.title }));

export const searchEntities = async (query: string): Promise<PickItem[]> =>
  (await api.entities(query)).map((e) => ({
    id: e.id,
    label: e.startYear === null ? e.name : `${e.name} (${formatPeriod(e.startYear, e.endYear)})`,
  }));
