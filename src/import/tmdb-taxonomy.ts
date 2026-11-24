import { TitleType } from '../titles/entities/title.entity';

export interface TmdbTerm {
  tmdbId: number;
  name: string;
}

function terms(value: unknown, field: string): TmdbTerm[] {
  if (!Array.isArray(value))
    throw new Error(`Отсутствует массив TMDB: ${field}`);
  const unique = new Map<number, TmdbTerm>();
  for (const item of value as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Некорректный элемент TMDB: ${field}`);
    }
    const { id, name } = item as Record<string, unknown>;
    if (
      typeof id !== 'number' ||
      !Number.isInteger(id) ||
      id <= 0 ||
      id > 2147483647 ||
      typeof name !== 'string' ||
      !name.trim()
    ) {
      throw new Error(`Некорректные ID или имя TMDB: ${field}`);
    }
    const normalizedName = name.trim();
    if (unique.has(id) && unique.get(id)!.name !== normalizedName) {
      throw new Error(`Разные имена одного ID TMDB: ${field}`);
    }
    unique.set(id, { tmdbId: id, name: normalizedName });
  }
  // Единый порядок блокировок справочников при параллельном импорте.
  return [...unique.values()].sort((a, b) => a.tmdbId - b.tmdbId);
}

export function mapTmdbTaxonomy(
  payload: Record<string, unknown>,
  type: TitleType,
) {
  const keywords = payload.keywords;
  if (!keywords || typeof keywords !== 'object' || Array.isArray(keywords)) {
    throw new Error('Отсутствует объект keywords TMDB');
  }
  return {
    genres: terms(payload.genres, 'genres'),
    keywords: terms(
      (keywords as Record<string, unknown>)[
        type === TitleType.MOVIE ? 'keywords' : 'results'
      ],
      'keywords',
    ),
  };
}
