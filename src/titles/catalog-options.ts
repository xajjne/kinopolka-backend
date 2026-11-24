import { BadRequestException } from '@nestjs/common';

export function positiveInteger(
  value: unknown,
  name: string,
  maximum = 2147483647,
): number {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > maximum
  ) {
    throw new BadRequestException(
      `${name} должен быть целым числом от 1 до ${maximum}`,
    );
  }
  return Number(value);
}

export function pagination(params: Record<string, unknown>) {
  return {
    page:
      params.page === undefined
        ? 1
        : positiveInteger(params.page, 'page', 10000),
    limit:
      params.limit === undefined
        ? 20
        : positiveInteger(params.limit, 'limit', 100),
  };
}

export function catalogOptions(params: Record<string, unknown>) {
  const pages = pagination(params);
  if (
    params.type !== undefined &&
    params.type !== 'movie' &&
    params.type !== 'series'
  ) {
    throw new BadRequestException('type должен быть movie или series');
  }
  if (
    params.q !== undefined &&
    (typeof params.q !== 'string' || params.q.trim().length > 200)
  ) {
    throw new BadRequestException('q должен быть строкой до 200 символов');
  }
  const sort = params.sort ?? 'popular';
  if (
    sort !== 'popular' &&
    sort !== 'rating' &&
    sort !== 'newest' &&
    sort !== 'title'
  ) {
    throw new BadRequestException(
      'sort должен быть popular, rating, newest или title',
    );
  }
  const year =
    params.year === undefined
      ? undefined
      : positiveInteger(params.year, 'year', 2100);
  if (year !== undefined && year < 1800)
    throw new BadRequestException('year должен быть от 1800 до 2100');
  const list = (key: string) => {
    const v = params[key];
    if (v === undefined) return [];
    if (typeof v !== 'string' || v.length > 6000)
      throw new BadRequestException('Некорректный список ' + key);
    return v
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  };
  const bound = (key: string) =>
    params[key] === undefined
      ? undefined
      : positiveInteger(params[key], key, 2100);
  const from = bound('from'),
    to = bound('to');
  if ((from && from < 1800) || (to && to < 1800) || (from && to && from > to))
    throw new BadRequestException('Недопустимый диапазон лет');
  return {
    ...pages,
    from,
    to,
    genres: list('genres'),
    countries: list('countries'),
    exclude: list('exclude').map((id) => positiveInteger(id, 'exclude')),
    anime: params.anime === 'true',
    minRating:
      params.minRating === undefined
        ? undefined
        : positiveInteger(params.minRating, 'minRating', 10),
    type: params.type,
    query: typeof params.q === 'string' ? params.q.trim() : undefined,
    genreId:
      params.genreId === undefined
        ? undefined
        : positiveInteger(params.genreId, 'genreId'),
    year,
    sort,
  };
}
