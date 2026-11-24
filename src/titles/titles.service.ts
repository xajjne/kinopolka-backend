import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Title } from './entities/title.entity';
import { TitleMedia } from './entities/title-media.entity';
import { catalogOptions, pagination } from './catalog-options';
import {
  creditRoles,
  imageItems,
  imageUrl,
  mediaView,
  number,
  rating,
  record,
  records,
  text,
  videoItems,
} from './catalog-format';

interface CardRow {
  id: number;
  type: string;
  tmdbId: number | null;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  releaseDate: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  popularity: number | null;
  voteAverage: number | null;
  voteCount: number | null;
}

export function card(row: CardRow) {
  return {
    id: row.id,
    type: row.type,
    tmdbId: row.tmdbId,
    title: row.title,
    originalTitle: row.originalTitle,
    overview: row.overview,
    releaseDate: row.releaseDate,
    posterPath: row.posterPath,
    posterUrl: imageUrl(row.posterPath),
    backdropPath: row.backdropPath,
    backdropUrl: imageUrl(row.backdropPath, 'w1280'),
    popularity: row.popularity,
    tmdbRating: {
      source: 'TMDB',
      value: row.voteAverage,
      votes: row.voteCount,
    },
  };
}

export const CARD_COLUMNS = `t.id, t.type, t.tmdb_id AS "tmdbId", t.title,
  t.original_title AS "originalTitle", t.overview, t.release_date::text AS "releaseDate",
  t.poster_path AS "posterPath", t.backdrop_path AS "backdropPath",
  CASE WHEN jsonb_typeof(t.tmdb_payload->'popularity') = 'number' THEN (t.tmdb_payload->>'popularity')::double precision END AS popularity,
  CASE WHEN jsonb_typeof(t.tmdb_payload->'vote_average') = 'number' THEN (t.tmdb_payload->>'vote_average')::double precision END AS "voteAverage",
  CASE WHEN jsonb_typeof(t.tmdb_payload->'vote_count') = 'number' THEN (t.tmdb_payload->>'vote_count')::integer END AS "voteCount"`;

@Injectable()
export class TitlesService {
  constructor(private readonly database: DataSource) {}

  async catalog(options: ReturnType<typeof catalogOptions>) {
    const conditions: string[] = [];
    const parameters: unknown[] = [];
    const add = (condition: string, value: unknown) => {
      parameters.push(value);
      conditions.push(condition.replace('?', `$${parameters.length}`));
    };
    if (options.type) add('t.type = ?', options.type);
    if (options.query) {
      const escaped = options.query.replace(/[\\%_]/g, '\\$&');
      parameters.push(`%${escaped}%`);
      conditions.push(
        `(t.title ILIKE $${parameters.length} OR t.original_title ILIKE $${parameters.length})`,
      );
    }
    if (options.genreId)
      add(
        'EXISTS (SELECT 1 FROM title_genres tg WHERE tg.title_id=t.id AND tg.genre_id=?)',
        options.genreId,
      );
    if (options.from) add('t.release_date >= ?::date', options.from + '-01-01');
    if (options.to) add('t.release_date < ?::date', options.to + 1 + '-01-01');
    if (options.minRating)
      add("(t.tmdb_payload->>'vote_average')::numeric >= ?", options.minRating);
    if (options.exclude.length) add('t.id <> ALL(?::int[])', options.exclude);
    if (options.genres.length)
      add(
        'EXISTS (SELECT 1 FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id AND g.name=ANY(?::text[]))',
        options.genres,
      );
    if (options.countries.length)
      add(
        "EXISTS (SELECT 1 FROM jsonb_array_elements(t.tmdb_payload->'production_countries') c WHERE c->>'iso_3166_1'=ANY(?::text[]))",
        options.countries,
      );
    if (options.anime)
      conditions.push(
        "t.original_language='ja' AND EXISTS (SELECT 1 FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id AND g.tmdb_id=16)",
      );
    if (options.year) {
      add('t.release_date >= ?::date', `${options.year}-01-01`);
      add('t.release_date < ?::date', `${options.year + 1}-01-01`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = {
      popular: 'popularity DESC NULLS LAST',
      rating: '"voteAverage" DESC NULLS LAST, "voteCount" DESC NULLS LAST',
      newest: 't.release_date DESC NULLS LAST',
      title: 't.title ASC',
    }[options.sort];
    const counts = await this.database.query<{ total: number }[]>(
      `SELECT count(*)::integer AS total FROM titles t ${where}`,
      parameters,
    );
    const rows = await this.database.query<(CardRow & { genres: string[] })[]>(
      `SELECT ${CARD_COLUMNS}, ARRAY(SELECT g.name FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id ORDER BY g.name) AS genres FROM titles t ${where}
      ORDER BY ${order}, t.id ASC LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
      [...parameters, options.limit, (options.page - 1) * options.limit],
    );
    return {
      page: options.page,
      limit: options.limit,
      total: counts[0].total,
      totalPages: Math.ceil(counts[0].total / options.limit),
      items: rows.map((row) => ({ ...card(row), genres: row.genres })),
    };
  }

  async shelfCards(ids: number[]) {
    if (!ids.length) return [];
    const rows = await this.database.query<
      (CardRow & { minutes: number | null; genres: string[] })[]
    >(
      `SELECT ${CARD_COLUMNS},t.runtime_minutes AS minutes, ARRAY(SELECT g.name FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id ORDER BY g.name) AS genres FROM titles t WHERE t.id=ANY($1::int[]) ORDER BY t.id`,
      [ids],
    );
    return rows.map((r) => ({
      ...card(r),
      genres: r.genres,
      minutes: r.minutes,
    }));
  }

  async genres(type?: 'movie' | 'series') {
    return this.database.query<
      {
        id: number;
        tmdbId: number;
        type: string;
        name: string;
        titleCount: number;
      }[]
    >(
      `
      SELECT g.id, g.tmdb_id AS "tmdbId", g.type, g.name, count(tg.title_id)::integer AS "titleCount"
      FROM genres g LEFT JOIN title_genres tg ON tg.genre_id=g.id
      ${type ? 'WHERE g.type=$1' : ''} GROUP BY g.id ORDER BY g.type, g.name, g.id
    `,
      type ? [type] : [],
    );
  }

  private async requireTitle(id: number) {
    const title = await this.database.getRepository(Title).findOneBy({ id });
    if (!title) throw new NotFoundException('Произведение не найдено');
    return title;
  }

  async forViewer(accountId: number) {
    return this.database.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('hnsw.ef_search','100',true), set_config('hnsw.iterative_scan','strict_order',true)",
      );
      const rows = await manager.query<CardRow[]>(
        `
        WITH seeds AS (
          SELECT e.*,CASE WHEN s.favorite THEN 4 WHEN s.rating>=9 THEN 3 WHEN s.rating>=7 THEN 2 ELSE 1 END AS weight
          FROM shelf_entries s JOIN title_embeddings e ON e.title_id=s.title_id
          WHERE s.account_id=$1 AND (s.favorite OR s.rating>=7 OR s.status='watched')
            AND (s.rating IS NULL OR s.rating>=7) AND s.status IS DISTINCT FROM 'dropped'
          ORDER BY weight DESC,s.updated_at DESC,s.title_id LIMIT 12
        ), matches AS (
          SELECT seed.weight,nn.title_id,nn.distance,
                 row_number() over(partition by seed.title_id order by nn.distance,nn.title_id) AS rank
          FROM seeds seed CROSS JOIN LATERAL (
            SELECT e.title_id,e.embedding <=> seed.embedding AS distance
            FROM title_embeddings e WHERE e.model_name=seed.model_name AND e.model_revision=seed.model_revision
              AND e.text_version=seed.text_version AND NOT EXISTS (
                SELECT 1 FROM shelf_entries s WHERE s.account_id=$1 AND s.title_id=e.title_id
                AND (s.favorite OR s.rating IS NOT NULL OR s.status<>'planned'))
            ORDER BY e.embedding <=> seed.embedding LIMIT 25
          ) nn
        ), ranked AS (
          SELECT title_id,sum(weight/(10.0+rank)) AS score,min(distance) AS nearest FROM matches
          GROUP BY title_id ORDER BY score DESC,nearest,title_id LIMIT 5
        ) SELECT ${CARD_COLUMNS} FROM ranked r JOIN titles t ON t.id=r.title_id ORDER BY r.score DESC,r.nearest,r.title_id
      `,
        [accountId],
      );
      return rows.map(card);
    });
  }

  async similar(
    id: number,
    limit: number,
    type?: 'movie' | 'series',
    exclude: number[] = [],
  ) {
    await this.requireTitle(id);
    const profiles = await this.database.query<
      {
        embedding: string;
        model_name: string;
        model_revision: string;
        text_version: number;
      }[]
    >(
      'SELECT embedding::text, model_name, model_revision, text_version FROM title_embeddings WHERE title_id=$1',
      [id],
    );
    if (!profiles.length)
      return { referenceTitleId: id, available: false, count: 0, items: [] };
    const profile = profiles[0];
    const rows = await this.database.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('hnsw.ef_search','100',true), set_config('hnsw.iterative_scan','strict_order',true)",
      );
      return manager.query<(CardRow & { distance: number })[]>(
        `
        SELECT ${CARD_COLUMNS}, e.embedding <=> $1::vector AS distance
        FROM title_embeddings e JOIN titles t ON t.id=e.title_id
        WHERE e.title_id<>$2 AND e.model_name=$3 AND e.model_revision=$4 AND e.text_version=$5
        AND e.title_id <> ALL($7::int[])
        ${type ? 'AND t.type=$8' : ''}
        ORDER BY e.embedding <=> $1::vector LIMIT $6
      `,
        [
          profile.embedding,
          id,
          profile.model_name,
          profile.model_revision,
          profile.text_version,
          limit,
          exclude,
          ...(type ? [type] : []),
        ],
      );
    });
    return {
      referenceTitleId: id,
      available: true,
      count: rows.length,
      items: rows.map((row) => ({
        ...card(row),
        distance: row.distance,
        similarity: 1 - row.distance,
      })),
    };
  }

  async gallery(
    id: number,
    kind: 'backdrops' | 'posters' | 'logos' | 'videos',
    pages: ReturnType<typeof pagination>,
  ) {
    await this.requireTitle(id);
    const media = await this.database
      .getRepository(TitleMedia)
      .createQueryBuilder('m')
      .addSelect('m.payload')
      .where('m.titleId=:id', { id })
      .getOne();
    const items =
      kind === 'videos'
        ? videoItems(media?.payload.videos)
        : imageItems(record(media?.payload.images)[kind]);
    return {
      loaded: Boolean(media),
      fetchedAt: media?.fetchedAt ?? null,
      kind,
      ...pages,
      total: items.length,
      items: items.slice(
        (pages.page - 1) * pages.limit,
        pages.page * pages.limit,
      ),
    };
  }

  async credits(
    id: number,
    kind: 'cast' | 'crew',
    pages: ReturnType<typeof pagination>,
  ) {
    await this.requireTitle(id);
    const totals = await this.database.query<{ total: number }[]>(
      'SELECT count(*)::integer AS total FROM title_credits WHERE title_id=$1 AND kind=$2',
      [id, kind],
    );
    const rows = await this.database.query<
      {
        personId: number;
        tmdbId: number;
        name: string;
        profilePath: string | null;
        entries: unknown;
      }[]
    >(
      `
      SELECT p.id AS "personId", p.tmdb_id AS "tmdbId", p.name, p.profile_path AS "profilePath", c.entries
      FROM title_credits c JOIN people p ON p.id=c.person_id WHERE c.title_id=$1 AND c.kind=$2
      ORDER BY c.sort_order, p.id LIMIT $3 OFFSET $4
    `,
      [id, kind, pages.limit, (pages.page - 1) * pages.limit],
    );
    return {
      ...pages,
      total: totals[0].total,
      items: rows.map((row) => ({
        personId: row.personId,
        tmdbId: row.tmdbId,
        name: row.name,
        profilePath: row.profilePath,
        profileUrl: imageUrl(row.profilePath, 'w185'),
        ...creditRoles(row.entries),
      })),
    };
  }

  async detail(id: number) {
    const title = await this.database
      .getRepository(Title)
      .createQueryBuilder('t')
      .addSelect('t.tmdbPayload')
      .where('t.id = :id', { id })
      .getOne();
    if (!title) throw new NotFoundException('Произведение не найдено');
    const payload = title.tmdbPayload ?? {};
    const [genres, keywords, cast, crew, media] = await Promise.all([
      this.database.query<{ id: number; tmdbId: number; name: string }[]>(
        'SELECT g.id, g.tmdb_id AS "tmdbId", g.name FROM genres g JOIN title_genres tg ON tg.genre_id=g.id WHERE tg.title_id=$1 ORDER BY g.name, g.id',
        [id],
      ),
      this.database.query<{ id: number; tmdbId: number; name: string }[]>(
        'SELECT k.id, k.tmdb_id AS "tmdbId", k.name FROM keywords k JOIN title_keywords tk ON tk.keyword_id=k.id WHERE tk.title_id=$1 ORDER BY k.name, k.id',
        [id],
      ),
      this.credits(id, 'cast', { page: 1, limit: 12 }),
      this.credits(id, 'crew', { page: 1, limit: 20 }),
      this.database
        .getRepository(TitleMedia)
        .createQueryBuilder('m')
        .addSelect('m.payload')
        .where('m.titleId = :id', { id })
        .getOne(),
    ]);
    // Главные создатели могут находиться за пределами первых двадцати участников.
    const creators = await this.database.query<
      { personId: number; name: string; entries: unknown }[]
    >(
      `
      SELECT p.id AS "personId", p.name, c.entries FROM title_credits c JOIN people p ON p.id=c.person_id
      WHERE c.title_id=$1 AND c.kind='crew' AND (
        c.entries @> '[{"job":"Director"}]'::jsonb OR c.entries @> '[{"job":"Screenplay"}]'::jsonb
        OR c.entries @> '[{"job":"Writer"}]'::jsonb
        OR jsonb_path_exists(c.entries, '$[*].jobs[*] ? (@.job == "Director" || @.job == "Screenplay" || @.job == "Writer")')
      ) ORDER BY c.sort_order, p.id
    `,
      [id],
    );
    return {
      id: title.id,
      type: title.type,
      tmdbId: title.tmdbId,
      title: title.title,
      originalTitle: title.originalTitle,
      overview: title.overview,
      tagline: title.tagline,
      releaseDate: title.releaseDate,
      runtimeMinutes: title.runtimeMinutes,
      status: title.status,
      originalLanguage: title.originalLanguage,
      posterPath: title.posterPath,
      posterUrl: imageUrl(title.posterPath),
      backdropPath: title.backdropPath,
      backdropUrl: imageUrl(title.backdropPath, 'w1280'),
      tmdbRating: rating(payload),
      externalRatings: await this.database.query(
        'SELECT source,score::float8 AS score,url,updated_at AS "updatedAt" FROM external_ratings WHERE title_id=$1 ORDER BY source',
        [id],
      ),
      popularity: number(payload.popularity),
      budget: number(payload.budget),
      revenue: number(payload.revenue),
      homepage: text(payload.homepage),
      imdbId: text(payload.imdb_id),
      countries: records(payload.production_countries),
      languages: records(payload.spoken_languages),
      companies: records(payload.production_companies).map((company) => ({
        id: number(company.id),
        name: text(company.name),
        logoUrl: imageUrl(company.logo_path),
      })),
      collection: Object.keys(record(payload.belongs_to_collection)).length
        ? record(payload.belongs_to_collection)
        : null,
      genres,
      keywords,
      cast,
      crew,
      creators: creators.map((person) => ({
        personId: person.personId,
        name: person.name,
        ...creditRoles(person.entries),
      })),
      seriesCreators: records(payload.created_by).map((person) => ({
        tmdbId: number(person.id),
        name: text(person.name),
        profileUrl: imageUrl(person.profile_path, 'w185'),
      })),
      seasons: records(payload.seasons).map((season) => ({
        tmdbId: number(season.id),
        name: text(season.name),
        seasonNumber: number(season.season_number),
        episodeCount: number(season.episode_count),
        airDate: text(season.air_date),
        overview: text(season.overview),
        posterUrl: imageUrl(season.poster_path),
      })),
      seasonCount: number(payload.number_of_seasons),
      episodeCount: number(payload.number_of_episodes),
      networks: records(payload.networks).map((network) => ({
        id: number(network.id),
        name: text(network.name),
        logoUrl: imageUrl(network.logo_path),
      })),
      media: mediaView(media?.payload ?? null, media?.fetchedAt ?? null),
    };
  }
}
