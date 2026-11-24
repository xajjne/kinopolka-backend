import { EntityManager, In } from 'typeorm';
import { Genre } from '../titles/entities/genre.entity';
import { Keyword } from '../titles/entities/keyword.entity';
import { TitleGenre } from '../titles/entities/title-genre.entity';
import { TitleKeyword } from '../titles/entities/title-keyword.entity';
import { Title } from '../titles/entities/title.entity';
import { mapTmdbTitle } from './tmdb-mapper';
import { mapTmdbTaxonomy } from './tmdb-taxonomy';
import { syncTitleCredits } from './tmdb-credits';

export async function saveTmdbTitle(
  manager: EntityManager,
  values: ReturnType<typeof mapTmdbTitle>,
) {
  const taxonomy = mapTmdbTaxonomy(values.tmdbPayload, values.type);
  return manager.transaction(async (transaction) => {
    const repository = transaction.getRepository(Title);
    const { tmdbPayload, ...columns } = values;
    // Upsert удерживает блокировку произведения до конца транзакции.
    await repository
      .createQueryBuilder()
      .insert()
      .values({ ...columns, tmdbPayload: () => 'CAST(:payload AS jsonb)' })
      .setParameter('payload', JSON.stringify(tmdbPayload))
      .orUpdate(
        [
          'title',
          'original_title',
          'overview',
          'release_date',
          'poster_path',
          'backdrop_path',
          'tagline',
          'runtime_minutes',
          'original_language',
          'status',
          'tmdb_payload',
          'tmdb_language',
          'tmdb_fetched_at',
        ],
        ['type', 'tmdb_id'],
      )
      .execute();
    const saved = await repository.findOneByOrFail({
      type: values.type,
      tmdbId: values.tmdbId,
    });

    const genres = transaction.getRepository(Genre);
    const keywords = transaction.getRepository(Keyword);
    const titleGenres = transaction.getRepository(TitleGenre);
    const titleKeywords = transaction.getRepository(TitleKeyword);

    if (taxonomy.genres.length) {
      await genres.upsert(
        taxonomy.genres.map((term) => ({ ...term, type: values.type })),
        {
          conflictPaths: ['type', 'tmdbId'],
          skipUpdateIfNoValuesChanged: true,
        },
      );
    }
    if (taxonomy.keywords.length) {
      await keywords.upsert(taxonomy.keywords, {
        conflictPaths: ['tmdbId'],
        skipUpdateIfNoValuesChanged: true,
      });
    }

    // Заменяем только связи текущего произведения; справочники общие.
    await titleGenres.delete({ titleId: saved.id });
    await titleKeywords.delete({ titleId: saved.id });
    if (taxonomy.genres.length) {
      const rows = await genres.findBy({
        type: values.type,
        tmdbId: In(taxonomy.genres.map((term) => term.tmdbId)),
      });
      await titleGenres.insert(
        rows.map((genre) => ({ titleId: saved.id, genreId: genre.id })),
      );
    }
    if (taxonomy.keywords.length) {
      const rows = await keywords.findBy({
        tmdbId: In(taxonomy.keywords.map((term) => term.tmdbId)),
      });
      await titleKeywords.insert(
        rows.map((keyword) => ({ titleId: saved.id, keywordId: keyword.id })),
      );
    }
    await syncTitleCredits(transaction, saved.id, tmdbPayload, values.type);
    return {
      saved,
      genreCount: taxonomy.genres.length,
      keywordCount: taxonomy.keywords.length,
    };
  });
}
