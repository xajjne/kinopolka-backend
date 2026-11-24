import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import dataSource from '../database/data-source';
import { TitleType } from '../titles/entities/title.entity';
import { saveTmdbTitle } from './save-tmdb-title';
import { TmdbClient, TmdbHttpError } from './tmdb-client';
import { mapTmdbTitle } from './tmdb-mapper';

interface ImportItem {
  status: 'pending' | 'done' | 'failed';
  attempts: number;
  error?: string;
}

interface ImportState {
  version: 1;
  type: TitleType;
  selection: 'discover-popularity-v1';
  pages: Record<string, number[]>;
  items: Record<string, ImportItem>;
}

async function readState(path: string, type: TitleType): Promise<ImportState> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        version: 1,
        type,
        selection: 'discover-popularity-v1',
        pages: {},
        items: {},
      };
    }
    throw error;
  }
  const state = JSON.parse(raw) as ImportState;
  if (
    state.version !== 1 ||
    state.type !== type ||
    state.selection !== 'discover-popularity-v1' ||
    !state.pages ||
    !state.items
  ) {
    throw new Error(
      'Некорректный файл прогресса импорта. Сохраните его и проверьте вручную.',
    );
  }
  for (const ids of Object.values(state.pages)) {
    if (
      !Array.isArray(ids) ||
      ids.some((id) => !Number.isInteger(id) || id <= 0 || id > 2147483647)
    ) {
      throw new Error('Некорректные ID в файле прогресса');
    }
    for (const id of ids) {
      const item = state.items[String(id)];
      if (
        !item ||
        !['pending', 'done', 'failed'].includes(item.status) ||
        !Number.isInteger(item.attempts)
      ) {
        throw new Error('Некорректное состояние задания импорта');
      }
    }
  }
  return state;
}

async function main() {
  const [rawType, rawPages] = process.argv.slice(2);
  if (
    process.argv.length !== 4 ||
    !['movie', 'series'].includes(rawType) ||
    !/^[1-9]\d*$/.test(rawPages ?? '') ||
    Number(rawPages) > 500
  ) {
    throw new Error(
      'Укажите movie или series и число страниц 1–500. Пример: movie 20',
    );
  }
  const type = rawType === 'movie' ? TitleType.MOVIE : TitleType.SERIES;
  const pageCount = Number(rawPages);
  const client = new TmdbClient(process.env.TMDB_READ_ACCESS_TOKEN ?? '');
  const directory = join(__dirname, '..', '..', '.local');
  const statePath = join(directory, `catalog-${type}.json`);
  await mkdir(directory, { recursive: true });

  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  let acquired = false;
  let stopping = false;
  const stop = () => {
    stopping = true;
    console.log('Останавливаемся после текущей записи...');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await runner.connect();
    if (await dataSource.showMigrations())
      throw new Error('Сначала примените миграции');
    const lockId = type === TitleType.MOVIE ? 1 : 2;
    const locks = (await runner.query(
      'SELECT pg_try_advisory_lock(74126, $1) AS acquired',
      [lockId],
    )) as { acquired: boolean }[];
    acquired = locks[0].acquired;
    if (!acquired) throw new Error(`Импорт ${type} уже выполняется`);

    const state = await readState(statePath, type);
    const saveState = async () => {
      const temporary = `${statePath}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
      await rename(temporary, statePath);
    };

    for (let page = 1; page <= pageCount && !stopping; page++) {
      if (!state.pages[String(page)]) {
        await sleep(350);
        const ids = await client.discover(type, page);
        state.pages[String(page)] = ids;
        for (const id of ids)
          state.items[String(id)] ??= { status: 'pending', attempts: 0 };
        await saveState();
        console.log(`${type}: сохранена страница ${page}, ID: ${ids.length}`);
      }
    }

    const ids = [
      ...new Set(
        Array.from(
          { length: pageCount },
          (_, i) => state.pages[String(i + 1)] ?? [],
        ).flat(),
      ),
    ];
    let imported = 0;
    let alreadyDone = 0;
    let failed = 0;
    let consecutiveFailures = 0;
    for (const id of ids) {
      if (stopping) break;
      const item = state.items[String(id)];
      const existing = (await runner.query(
        'SELECT id FROM titles WHERE type = $1 AND tmdb_id = $2 AND tmdb_payload IS NOT NULL',
        [type, id],
      )) as { id: number }[];
      if (existing.length) {
        item.status = 'done';
        delete item.error;
        alreadyDone++;
        await saveState();
        continue;
      }
      // Даже помеченная выполненной запись импортируется заново, если её удалили из БД.
      item.status = 'pending';
      item.attempts++;
      try {
        await sleep(350);
        const payload = await client.getDetails(type, id);
        const values = mapTmdbTitle(payload, type, id);
        const { saved } = await saveTmdbTitle(runner.manager, values);
        item.status = 'done';
        delete item.error;
        imported++;
        consecutiveFailures = 0;
        console.log(
          `${type} ${id}: ${saved.title} [${imported + alreadyDone}/${ids.length}]`,
        );
      } catch (error) {
        item.status = 'failed';
        item.error = (
          error instanceof Error ? error.message : 'Неизвестная ошибка'
        ).slice(0, 500);
        failed++;
        consecutiveFailures++;
        console.error(`${type} ${id}: ${item.error}`);
        if (
          error instanceof TmdbHttpError &&
          [401, 403, 429].includes(error.status)
        )
          stopping = true;
        if (consecutiveFailures >= 3) stopping = true;
      }
      await saveState();
    }
    console.log(
      JSON.stringify(
        {
          type,
          planned: ids.length,
          imported,
          alreadyDone,
          failed,
          stopped: stopping,
          statePath,
        },
        null,
        2,
      ),
    );
    if (failed || stopping) process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (acquired)
      await runner.query('SELECT pg_advisory_unlock(74126, $1)', [
        type === TitleType.MOVIE ? 1 : 2,
      ]);
    await runner.release();
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Ошибка массового импорта:',
    error instanceof Error ? error.message : 'Неизвестная ошибка',
  );
  process.exitCode = 1;
});
