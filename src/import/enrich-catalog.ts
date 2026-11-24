import { setTimeout as sleep } from 'node:timers/promises';
import dataSource from '../database/data-source';
import { TitleType } from '../titles/entities/title.entity';
import { TmdbClient, TmdbHttpError } from './tmdb-client';

async function main() {
  const [mode, selector = '25'] = process.argv.slice(2);
  if (!['media', 'people'].includes(mode) || process.argv.length > 4)
    throw new Error('Укажите media или people и лимит (либо --ids=1,2,3)');
  let ids: number[] | null = null;
  let limit = 25;
  if (selector.startsWith('--ids=')) {
    const parts = selector.slice(6).split(',');
    if (
      !parts.length ||
      parts.length > 100 ||
      parts.some((id) => !/^[1-9]\d*$/.test(id) || Number(id) > 2147483647)
    )
      throw new Error('Некорректные внутренние ID');
    ids = [...new Set(parts.map(Number))];
    limit = ids.length;
  } else {
    if (!/^[1-9]\d*$/.test(selector) || Number(selector) > 1000)
      throw new Error('Лимит должен быть от 1 до 1000');
    limit = Number(selector);
  }
  const client = new TmdbClient(process.env.TMDB_READ_ACCESS_TOKEN ?? '');
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  let locked = false;
  let stopping = false;
  const stop = () => {
    stopping = true;
    console.log('Завершаем текущую запись...');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await runner.connect();
    if (await dataSource.showMigrations())
      throw new Error('Сначала примените миграции');
    const lockId = mode === 'media' ? 1 : 2;
    const lock = await runner.manager.query<{ acquired: boolean }[]>(
      'SELECT pg_try_advisory_lock(74127, $1) AS acquired',
      [lockId],
    );
    locked = lock[0].acquired;
    if (!locked) throw new Error('Такое обогащение уже запущено');
    let imported = 0;
    let failures = 0;
    let consecutiveFailures = 0;
    const rows =
      mode === 'media'
        ? await runner.manager.query<
            { id: number; tmdb_id: number; type: TitleType }[]
          >(
            `
          SELECT t.id, t.tmdb_id, t.type FROM titles t LEFT JOIN title_media m ON m.title_id=t.id
          WHERE t.tmdb_id IS NOT NULL ${ids ? 'AND t.id = ANY($1::integer[])' : 'AND m.title_id IS NULL'}
          ORDER BY t.id LIMIT $${ids ? 2 : 1}
        `,
            ids ? [ids, limit] : [limit],
          )
        : await runner.manager.query<
            { id: number; tmdb_id: number; type?: TitleType }[]
          >(
            `
          SELECT p.id, p.tmdb_id FROM people p
          WHERE ${ids ? 'p.id = ANY($1::integer[])' : 'p.tmdb_fetched_at IS NULL'}
          ORDER BY p.id LIMIT $${ids ? 2 : 1}
        `,
            ids ? [ids, limit] : [limit],
          );
    for (const row of rows) {
      if (stopping) break;
      try {
        await sleep(350);
        if (mode === 'media') {
          const payload = await client.getMedia(row.type!, row.tmdb_id);
          await runner.query(
            `INSERT INTO title_media (title_id,payload) VALUES ($1,$2::jsonb)
            ON CONFLICT (title_id) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=now()`,
            [row.id, JSON.stringify(payload)],
          );
        } else {
          const payload = await client.getPerson(row.tmdb_id);
          await runner.query(
            `UPDATE people SET name=$2, profile_path=COALESCE($3,profile_path),
            tmdb_payload=$4::jsonb,tmdb_fetched_at=now(),updated_at=now() WHERE id=$1`,
            [
              row.id,
              payload.name,
              typeof payload.profile_path === 'string'
                ? payload.profile_path
                : null,
              JSON.stringify(payload),
            ],
          );
        }
        imported++;
        consecutiveFailures = 0;
        console.log(
          `${mode}: ID ${row.id}, загружено ${imported}/${rows.length}`,
        );
      } catch (error) {
        failures++;
        consecutiveFailures++;
        console.error(
          `ID ${row.id}:`,
          error instanceof Error ? error.message : 'Ошибка загрузки',
        );
        if (
          consecutiveFailures >= 3 ||
          (error instanceof TmdbHttpError &&
            [401, 403, 429].includes(error.status))
        )
          stopping = true;
      }
    }
    console.log(
      JSON.stringify({
        mode,
        selected: rows.length,
        imported,
        failures,
        stopped: stopping,
      }),
    );
    if (failures || stopping) process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (locked)
      await runner.query('SELECT pg_advisory_unlock(74127, $1)', [
        mode === 'media' ? 1 : 2,
      ]);
    await runner.release();
    await dataSource.destroy();
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Ошибка обогащения');
  process.exitCode = 1;
});
