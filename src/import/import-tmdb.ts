import dataSource from '../database/data-source';
import { parseImportArguments, TmdbClient } from './tmdb-client';
import { mapTmdbTitle } from './tmdb-mapper';
import { saveTmdbTitle } from './save-tmdb-title';

async function main() {
  const { type, tmdbId } = parseImportArguments(process.argv.slice(2));
  const client = new TmdbClient(process.env.TMDB_READ_ACCESS_TOKEN ?? '');
  const payload = await client.getDetails(type, tmdbId);
  const values = mapTmdbTitle(payload, type, tmdbId);

  await dataSource.initialize();
  try {
    if (await dataSource.showMigrations()) {
      throw new Error('Сначала примените ожидающие миграции базы данных.');
    }
    const { saved, genreCount, keywordCount } = await saveTmdbTitle(
      dataSource.manager,
      values,
    );
    console.log(
      JSON.stringify(
        {
          id: saved.id,
          type: saved.type,
          tmdbId: saved.tmdbId,
          title: saved.title,
          releaseDate: saved.releaseDate,
          hasPoster: Boolean(saved.posterPath),
          hasBackdrop: Boolean(saved.backdropPath),
          fetchedAt: saved.tmdbFetchedAt,
          genreCount,
          keywordCount,
        },
        null,
        2,
      ),
    );
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  // Не печатаем объект ошибки БД: он может содержать запрос и весь JSON.
  console.error(
    'Ошибка импорта:',
    error instanceof Error ? error.message : 'Неизвестная ошибка',
  );
  process.exitCode = 1;
});
