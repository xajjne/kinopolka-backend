import { setTimeout as sleep } from 'node:timers/promises';
import { TitleType } from '../titles/entities/title.entity';

export class TmdbHttpError extends Error {
  constructor(readonly status: number) {
    super(`TMDB вернул HTTP ${status}`);
  }
}

export function parseImportArguments(args: string[]) {
  const [type, rawId] = args;
  if (
    args.length !== 2 ||
    (type !== 'movie' && type !== 'series') ||
    !/^[1-9]\d*$/.test(rawId ?? '') ||
    !Number.isSafeInteger(Number(rawId)) ||
    Number(rawId) > 2147483647
  ) {
    throw new Error(
      'Укажите тип movie или series и положительный TMDB ID. Пример: movie 550',
    );
  }
  return {
    type: type === 'movie' ? TitleType.MOVIE : TitleType.SERIES,
    tmdbId: Number(rawId),
  };
}

export class TmdbClient {
  constructor(
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
    private readonly pause: (ms: number) => Promise<unknown> = sleep,
  ) {
    if (!token.trim()) throw new Error('Не задан TMDB_READ_ACCESS_TOKEN');
  }

  async getDetails(type: TitleType, tmdbId: number): Promise<unknown> {
    const resource = type === TitleType.MOVIE ? 'movie' : 'tv';
    const url = new URL(`https://api.themoviedb.org/3/${resource}/${tmdbId}`);
    url.searchParams.set('language', 'ru-RU');
    url.searchParams.set(
      'append_to_response',
      type === TitleType.MOVIE
        ? 'credits,keywords'
        : 'aggregate_credits,keywords',
    );

    return this.getJson(url);
  }

  async discover(type: TitleType, page: number): Promise<number[]> {
    const resource = type === TitleType.MOVIE ? 'movie' : 'tv';
    const url = new URL(`https://api.themoviedb.org/3/discover/${resource}`);
    url.searchParams.set('language', 'ru-RU');
    url.searchParams.set('include_adult', 'false');
    url.searchParams.set('sort_by', 'popularity.desc');
    url.searchParams.set('vote_count.gte', '50');
    url.searchParams.set('page', String(page));
    const payload = await this.getJson(url);
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray((payload as Record<string, unknown>).results)
    ) {
      throw new Error('Некорректная страница каталога TMDB');
    }
    const results = (payload as { results: unknown[] }).results;
    const ids = results.map((item) => {
      const id =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>).id
          : undefined;
      if (
        typeof id !== 'number' ||
        !Number.isInteger(id) ||
        id <= 0 ||
        id > 2147483647
      ) {
        throw new Error('Некорректный ID в каталоге TMDB');
      }
      return id;
    });
    return [...new Set(ids)];
  }

  async getMedia(
    type: TitleType,
    id: number,
  ): Promise<Record<string, unknown>> {
    const resource = type === TitleType.MOVIE ? 'movie' : 'tv';
    const url = new URL(`https://api.themoviedb.org/3/${resource}/${id}`);
    url.searchParams.set('language', 'ru-RU');
    url.searchParams.set('include_image_language', 'ru,en,null');
    url.searchParams.set(
      'append_to_response',
      `images,videos,${type === TitleType.MOVIE ? 'release_dates' : 'content_ratings'}`,
    );
    const raw = await this.getJson(url);
    if (
      !raw ||
      typeof raw !== 'object' ||
      (raw as Record<string, unknown>).id !== id
    )
      throw new Error('Некорректный ID медиаданных TMDB');
    const data = raw as Record<string, unknown>;
    const images = data.images as Record<string, unknown> | undefined;
    const videos = data.videos as Record<string, unknown> | undefined;
    const certification = data[
      type === TitleType.MOVIE ? 'release_dates' : 'content_ratings'
    ] as Record<string, unknown> | undefined;
    if (
      !images ||
      !Array.isArray(images.backdrops) ||
      !Array.isArray(images.posters) ||
      !Array.isArray(images.logos) ||
      !videos ||
      !Array.isArray(videos.results) ||
      !certification ||
      !Array.isArray(certification.results)
    ) {
      throw new Error('TMDB вернул неполные медиаданные');
    }
    const englishUrl = new URL(
      `https://api.themoviedb.org/3/${resource}/${id}/videos`,
    );
    englishUrl.searchParams.set('language', 'en-US');
    const english = await this.getJson(englishUrl);
    if (
      !english ||
      typeof english !== 'object' ||
      !Array.isArray((english as Record<string, unknown>).results)
    )
      throw new Error('Некорректные англоязычные видео TMDB');
    const combined = [
      ...(videos.results as unknown[]),
      ...(english as { results: unknown[] }).results,
    ];
    const unique = new Map<string, Record<string, unknown>>();
    for (const entry of combined) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        throw new Error('Некорректная запись видео TMDB');
      const video = entry as Record<string, unknown>;
      if (typeof video.site !== 'string' || typeof video.key !== 'string')
        throw new Error('Отсутствует источник видео TMDB');
      const key = `${video.site}:${video.key}`;
      if (!unique.has(key)) unique.set(key, video);
    }
    return {
      images,
      videos: [...unique.values()],
      release_dates: type === TitleType.MOVIE ? certification : null,
      content_ratings: type === TitleType.SERIES ? certification : null,
    };
  }

  async getPerson(id: number): Promise<Record<string, unknown>> {
    const url = new URL(`https://api.themoviedb.org/3/person/${id}`);
    url.searchParams.set('language', 'ru-RU');
    url.searchParams.set('append_to_response', 'combined_credits,images');
    const raw = await this.getJson(url);
    if (!raw || typeof raw !== 'object')
      throw new Error('Некорректная персона TMDB');
    const data = raw as Record<string, unknown>;
    const credits = data.combined_credits as
      Record<string, unknown> | undefined;
    if (
      data.id !== id ||
      typeof data.name !== 'string' ||
      !data.name.trim() ||
      !credits ||
      !Array.isArray(credits.cast) ||
      !Array.isArray(credits.crew)
    ) {
      throw new Error('TMDB вернул неполные сведения о персоне');
    }
    if (typeof data.biography !== 'string' || !data.biography.trim()) {
      const fallbackUrl = new URL(`https://api.themoviedb.org/3/person/${id}`);
      fallbackUrl.searchParams.set('language', 'en-US');
      const fallback = await this.getJson(fallbackUrl);
      if (
        !fallback ||
        typeof fallback !== 'object' ||
        (fallback as Record<string, unknown>).id !== id
      )
        throw new Error('Некорректная запасная биография TMDB');
      data.biography_fallback = fallback;
    }
    return data;
  }

  private async getJson(url: URL): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await this.request(url, {
          headers: {
            Authorization: `Bearer ${this.token.trim()}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(20000),
          redirect: 'error',
        });
      } catch {
        if (attempt === 2)
          throw new Error(
            'Нет соединения с TMDB после трёх попыток. Проверьте сеть и локальный прокси.',
          );
        await this.pause(1000 * 2 ** attempt);
        continue;
      }

      if (response.ok) {
        try {
          return (await response.json()) as unknown;
        } catch {
          if (attempt < 2) {
            await this.pause(1000 * 2 ** attempt);
            continue;
          }
          throw new Error(
            'TMDB вернул нечитаемый JSON; данные в базе не изменены.',
          );
        }
      }

      await response.body?.cancel();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) throw new TmdbHttpError(response.status);

      let delay = 1000 * 2 ** attempt;
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter !== null) {
        const seconds = Number(retryAfter);
        const requested = Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(requested)) delay = Math.max(delay, requested);
      }
      // Не повторяем запрос раньше срока, указанного сервером.
      if (delay > 30000)
        throw new Error(
          'TMDB просит подождать более 30 секунд. Повторите импорт позже.',
        );
      await this.pause(delay);
    }
    throw new Error('Не удалось получить данные TMDB');
  }
}
