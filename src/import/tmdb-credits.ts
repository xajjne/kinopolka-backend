import { EntityManager } from 'typeorm';
import { TitleType } from '../titles/entities/title.entity';
import { TitleCredit } from '../titles/entities/title-credit.entity';

interface CreditGroup {
  tmdbId: number;
  kind: 'cast' | 'crew';
  sortOrder: number;
  entries: Record<string, unknown>[];
}

export function mapTmdbCredits(
  payload: Record<string, unknown>,
  type: TitleType,
) {
  const raw =
    payload[type === TitleType.MOVIE ? 'credits' : 'aggregate_credits'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Отсутствует состав TMDB');
  const credits = raw as Record<string, unknown>;
  const people = new Map<
    number,
    { tmdb_id: number; name: string; profile_path: string | null }
  >();
  const groups = new Map<string, CreditGroup>();
  for (const kind of ['cast', 'crew'] as const) {
    const entries = credits[kind];
    if (!Array.isArray(entries)) throw new Error(`Отсутствует массив ${kind}`);
    (entries as unknown[]).forEach((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        throw new Error('Некорректная запись состава');
      const item = entry as Record<string, unknown>;
      const id = item.id;
      if (
        typeof id !== 'number' ||
        !Number.isInteger(id) ||
        id <= 0 ||
        id > 2147483647 ||
        typeof item.name !== 'string' ||
        !item.name.trim()
      ) {
        throw new Error('Некорректные ID или имя персоны');
      }
      people.set(id, {
        tmdb_id: id,
        name: item.name.trim(),
        profile_path:
          typeof item.profile_path === 'string' ? item.profile_path : null,
      });
      const key = `${kind}:${id}`;
      const group = groups.get(key) ?? {
        tmdbId: id,
        kind,
        sortOrder: index,
        entries: [],
      };
      group.entries.push(item);
      groups.set(key, group);
    });
  }
  return {
    people: [...people.values()].sort((a, b) => a.tmdb_id - b.tmdb_id),
    groups: [...groups.values()],
  };
}

// Вызывается внутри транзакции, удерживающей блокировку произведения.
export async function syncTitleCredits(
  manager: EntityManager,
  titleId: number,
  payload: Record<string, unknown>,
  type: TitleType,
) {
  const mapped = mapTmdbCredits(payload, type);
  const ids = new Map<number, number>();
  for (let offset = 0; offset < mapped.people.length; offset += 500) {
    const rows = await manager.query<{ id: number; tmdb_id: number }[]>(
      `
      INSERT INTO people (tmdb_id, name, profile_path)
      SELECT tmdb_id, name, profile_path
      FROM jsonb_to_recordset($1::jsonb) AS p(tmdb_id integer, name text, profile_path text)
      ORDER BY tmdb_id
      ON CONFLICT (tmdb_id) DO UPDATE SET
        name = CASE WHEN people.tmdb_fetched_at IS NULL THEN EXCLUDED.name ELSE people.name END,
        profile_path = COALESCE(people.profile_path, EXCLUDED.profile_path),
        updated_at = now()
      RETURNING id, tmdb_id
    `,
      [JSON.stringify(mapped.people.slice(offset, offset + 500))],
    );
    for (const person of rows) ids.set(person.tmdb_id, person.id);
  }
  const repository = manager.getRepository(TitleCredit);
  await repository.delete({ titleId });
  const links = mapped.groups.map((group) => ({
    titleId,
    personId: ids.get(group.tmdbId)!,
    kind: group.kind,
    sortOrder: group.sortOrder,
    entries: group.entries,
  }));
  // QueryBuilder интерпретирует вложенный JSON как DeepPartial: передаём параметрами.
  for (let offset = 0; offset < links.length; offset += 500) {
    await manager.query(
      `
      INSERT INTO title_credits (title_id, person_id, kind, sort_order, entries)
      SELECT "titleId", "personId", kind, "sortOrder", entries
      FROM jsonb_to_recordset($1::jsonb) AS c("titleId" integer, "personId" integer, kind text, "sortOrder" integer, entries jsonb)
    `,
      [JSON.stringify(links.slice(offset, offset + 500))],
    );
  }
  return { peopleCount: mapped.people.length, creditCount: links.length };
}
