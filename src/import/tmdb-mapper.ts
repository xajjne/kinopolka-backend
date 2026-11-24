import { TitleType } from '../titles/entities/title.entity';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Ожидался JSON-объект TMDB');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string')
    throw new Error(`Некорректное поле TMDB: ${field}`);
  return value.trim() || null;
}

function date(value: unknown): string | null {
  const result = text(value, 'release_date / first_air_date');
  if (result === null) return null;
  const parsed = new Date(result);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== result
  ) {
    throw new Error('Некорректная дата TMDB');
  }
  return result;
}

export function mapTmdbTitle(
  payload: unknown,
  type: TitleType,
  tmdbId: number,
) {
  const data = object(payload);
  if (data.id !== tmdbId)
    throw new Error('ID ответа TMDB не совпадает с запрошенным');
  const movie = type === TitleType.MOVIE;
  const title = text(movie ? data.title : data.name, 'title / name');
  if (!title) throw new Error('TMDB не вернул название');

  // Ошибка вложенного запроса не должна затереть ранее сохранённый состав.
  const credits = object(movie ? data.credits : data.aggregate_credits);
  const keywords = object(data.keywords);
  if (
    !Array.isArray(data.genres) ||
    !Array.isArray(credits.cast) ||
    !Array.isArray(credits.crew) ||
    !Array.isArray(movie ? keywords.keywords : keywords.results)
  ) {
    throw new Error('TMDB вернул неполные жанры, состав или ключевые слова');
  }

  let runtimeMinutes: number | null = null;
  if (movie && data.runtime !== undefined && data.runtime !== null) {
    if (
      typeof data.runtime !== 'number' ||
      !Number.isInteger(data.runtime) ||
      data.runtime < 0 ||
      data.runtime > 2147483647
    ) {
      throw new Error('Некорректная продолжительность TMDB');
    }
    runtimeMinutes = data.runtime === 0 ? null : data.runtime;
  }

  return {
    type,
    tmdbId,
    title,
    originalTitle: text(
      movie ? data.original_title : data.original_name,
      'original_title / original_name',
    ),
    overview: text(data.overview, 'overview'),
    releaseDate: date(movie ? data.release_date : data.first_air_date),
    posterPath: text(data.poster_path, 'poster_path'),
    backdropPath: text(data.backdrop_path, 'backdrop_path'),
    tagline: text(data.tagline, 'tagline'),
    runtimeMinutes,
    originalLanguage: text(data.original_language, 'original_language'),
    status: text(data.status, 'status'),
    tmdbPayload: data,
    tmdbLanguage: 'ru-RU',
    tmdbFetchedAt: new Date(),
  };
}
