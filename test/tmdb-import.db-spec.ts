import type { QueryRunner } from 'typeorm';
import dataSource from '../src/database/data-source';
import { mapTmdbTitle } from '../src/import/tmdb-mapper';
import { saveTmdbTitle } from '../src/import/save-tmdb-title';
import { Genre } from '../src/titles/entities/genre.entity';
import { Keyword } from '../src/titles/entities/keyword.entity';
import { TitleGenre } from '../src/titles/entities/title-genre.entity';
import { TitleKeyword } from '../src/titles/entities/title-keyword.entity';
import { Title, TitleType } from '../src/titles/entities/title.entity';

// Явный запуск test:db. Все изменения тестовых строк откатываются.
describe('TMDB import in PostgreSQL', () => {
  let runner: QueryRunner;
  const sourceId = 2000000001;
  const payload = {
    id: sourceId,
    title: 'Integration fixture',
    genres: [{ id: sourceId, name: 'Fixture genre' }],
    credits: { cast: [], crew: [] },
    keywords: { keywords: [{ id: sourceId, name: 'Fixture keyword' }] },
  };
  const values = () => mapTmdbTitle(payload, TitleType.MOVIE, sourceId);

  beforeAll(async () => {
    await dataSource.initialize();
    if (await dataSource.showMigrations())
      throw new Error('Примените миграции перед test:db');
  });
  afterAll(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });
  beforeEach(async () => {
    runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const existing = await runner.manager
      .getRepository(Title)
      .findOneBy({ tmdbId: sourceId });
    if (existing) throw new Error('Тестовый TMDB ID уже занят');
  });
  afterEach(async () => {
    if (runner?.isTransactionActive) await runner.rollbackTransaction();
    if (runner && !runner.isReleased) await runner.release();
  });

  it('repeats imports without duplicates and removes obsolete links only for this title', async () => {
    const first = await saveTmdbTitle(runner.manager, values());
    const repeated = await saveTmdbTitle(runner.manager, values());
    expect(repeated.saved.id).toBe(first.saved.id);
    expect(
      await runner.manager.count(TitleGenre, {
        where: { titleId: first.saved.id },
      }),
    ).toBe(1);
    expect(
      await runner.manager.count(TitleKeyword, {
        where: { titleId: first.saved.id },
      }),
    ).toBe(1);

    const otherPayload = { ...payload, id: sourceId + 1 };
    const other = await saveTmdbTitle(
      runner.manager,
      mapTmdbTitle(otherPayload, TitleType.MOVIE, sourceId + 1),
    );
    const emptyPayload = { ...payload, genres: [], keywords: { keywords: [] } };
    await saveTmdbTitle(
      runner.manager,
      mapTmdbTitle(emptyPayload, TitleType.MOVIE, sourceId),
    );
    expect(
      await runner.manager.count(TitleGenre, {
        where: { titleId: first.saved.id },
      }),
    ).toBe(0);
    expect(
      await runner.manager.count(TitleKeyword, {
        where: { titleId: first.saved.id },
      }),
    ).toBe(0);
    expect(
      await runner.manager.count(TitleGenre, {
        where: { titleId: other.saved.id },
      }),
    ).toBe(1);
    expect(
      await runner.manager.count(TitleKeyword, {
        where: { titleId: other.saved.id },
      }),
    ).toBe(1);
    expect(
      await runner.manager.count(Genre, { where: { tmdbId: sourceId } }),
    ).toBe(1);
    expect(
      await runner.manager.count(Keyword, { where: { tmdbId: sourceId } }),
    ).toBe(1);
  });

  it('rolls back title, JSONB, dictionaries and links on a late write failure', async () => {
    const { saved } = await saveTmdbTitle(runner.manager, values());
    const originalQuery = runner.query.bind(runner) as QueryRunner['query'];
    const spy = jest
      .spyOn(runner, 'query')
      .mockImplementation(async (...args: Parameters<typeof runner.query>) => {
        if (args[0].startsWith('INSERT INTO "title_keywords"'))
          throw new Error('Injected write failure');
        return (await originalQuery(...args)) as unknown;
      });
    const changed = {
      ...payload,
      title: 'Changed',
      genres: [{ id: sourceId, name: 'Changed genre' }],
    };
    try {
      await expect(
        saveTmdbTitle(
          runner.manager,
          mapTmdbTitle(changed, TitleType.MOVIE, sourceId),
        ),
      ).rejects.toThrow('Injected write failure');
    } finally {
      spy.mockRestore();
    }
    const actual = await runner.manager
      .getRepository(Title)
      .createQueryBuilder('title')
      .addSelect('title.tmdbPayload')
      .where('title.id = :id', { id: saved.id })
      .getOneOrFail();
    expect(actual.title).toBe(payload.title);
    expect(actual.tmdbPayload).toEqual(payload);
    expect(
      (
        await runner.manager.findOneByOrFail(Genre, {
          type: TitleType.MOVIE,
          tmdbId: sourceId,
        })
      ).name,
    ).toBe('Fixture genre');
    expect(
      await runner.manager.count(TitleGenre, { where: { titleId: saved.id } }),
    ).toBe(1);
    expect(
      await runner.manager.count(TitleKeyword, {
        where: { titleId: saved.id },
      }),
    ).toBe(1);
  });

  it('rolls back the whole import when cast validation fails after the title write', async () => {
    const invalid = {
      ...payload,
      credits: { cast: [{ id: -1, name: 'Invalid actor' }], crew: [] },
    };
    await expect(
      saveTmdbTitle(
        runner.manager,
        mapTmdbTitle(invalid, TitleType.MOVIE, sourceId),
      ),
    ).rejects.toThrow('Некорректные ID или имя персоны');
    expect(
      await runner.manager.count(Title, { where: { tmdbId: sourceId } }),
    ).toBe(0);
    expect(
      await runner.manager.count(Genre, { where: { tmdbId: sourceId } }),
    ).toBe(0);
    expect(
      await runner.manager.count(Keyword, { where: { tmdbId: sourceId } }),
    ).toBe(0);
  });

  it('enforces uniqueness and foreign keys, and cascades title deletion only to links', async () => {
    const { saved } = await saveTmdbTitle(runner.manager, values());
    const link = await runner.manager.findOneByOrFail(TitleGenre, {
      titleId: saved.id,
    });
    await expect(
      runner.manager.transaction((tx) =>
        tx.insert(TitleGenre, { titleId: saved.id, genreId: link.genreId }),
      ),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await expect(
      runner.manager.transaction((tx) =>
        tx.insert(TitleGenre, { titleId: saved.id, genreId: -1 }),
      ),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    await runner.manager.delete(Title, saved.id);
    expect(
      await runner.manager.count(TitleGenre, { where: { titleId: saved.id } }),
    ).toBe(0);
    expect(
      await runner.manager.count(TitleKeyword, {
        where: { titleId: saved.id },
      }),
    ).toBe(0);
    expect(
      await runner.manager.count(Genre, { where: { id: link.genreId } }),
    ).toBe(1);
  });
});
