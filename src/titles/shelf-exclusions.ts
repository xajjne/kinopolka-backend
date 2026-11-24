import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Старые демонстрационные карточки имели текстовые ключи. Идентификаторы TMDB стабильны при повторном импорте.
const legacy: Record<string, [string, number]> = {
  dune: ['movie', 693134],
  'dune-2021': ['movie', 438631],
  severance: ['series', 95396],
  'blade-runner': ['movie', 335984],
  'spirited-away': ['movie', 129],
  arrival: ['movie', 329865],
  interstellar: ['movie', 157336],
  inception: ['movie', 27205],
  'grand-budapest': ['movie', 120467],
};
export async function shelfExclusions(
  db: DataSource,
  input: unknown,
): Promise<number[]> {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 10000)
    throw new BadRequestException('Некорректный список исключений');
  const ids = new Set<number>();
  const movies: number[] = [];
  const series: number[] = [];
  for (const id of input) {
    if (typeof id !== 'string')
      throw new BadRequestException('Некорректный ID полки');
    if (/^[1-9]\d{0,9}$/.test(id) && Number(id) <= 2147483647)
      ids.add(Number(id));
    else if (Object.hasOwn(legacy, id)) {
      const [kind, tmdb] = legacy[id];
      (kind === 'movie' ? movies : series).push(tmdb);
    } else throw new BadRequestException('Неизвестный ID полки');
  }
  if (movies.length || series.length) {
    const rows = await db.query<{ id: number }[]>(
      "SELECT id FROM titles WHERE (type='movie' AND tmdb_id=ANY($1::int[])) OR (type='series' AND tmdb_id=ANY($2::int[]))",
      [movies, series],
    );
    for (const r of rows) ids.add(r.id);
  }
  return [...ids];
}
