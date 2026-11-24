import { BadRequestException } from '@nestjs/common';

export interface SearchOptions {
  query: string;
  limit: number;
  type?: 'movie' | 'series';
  genreId?: number;
  exclude?: number[];
}

function integer(value: unknown, name: string, max: number): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new BadRequestException(
      `${name} должен быть положительным целым числом`,
    );
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > max) {
    throw new BadRequestException(`${name} должен быть не больше ${max}`);
  }
  return number;
}

export function parseSearchOptions(
  params: Record<string, unknown>,
): SearchOptions {
  if (
    typeof params.q !== 'string' ||
    !params.q.trim() ||
    params.q.trim().length > 1000
  ) {
    throw new BadRequestException('q должен содержать от 1 до 1000 символов');
  }
  if (
    params.type !== undefined &&
    params.type !== 'movie' &&
    params.type !== 'series'
  ) {
    throw new BadRequestException('type должен быть movie или series');
  }
  return {
    query: params.q.trim(),
    limit: params.limit === undefined ? 10 : integer(params.limit, 'limit', 50),
    type: params.type,
    genreId:
      params.genreId === undefined
        ? undefined
        : integer(params.genreId, 'genreId', 2147483647),
  };
}
