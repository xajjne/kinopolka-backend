import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum TitleType {
  MOVIE = 'movie',
  SERIES = 'series',
}

@Entity('titles')
@Unique('uq_titles_type_tmdb_id', ['type', 'tmdbId'])
@Check('chk_titles_title_not_blank', 'length(btrim("title")) > 0')
@Check('chk_titles_tmdb_id_positive', '"tmdb_id" > 0')
@Check('chk_titles_runtime_positive', '"runtime_minutes" > 0')
@Check(
  'chk_titles_tmdb_payload_object',
  `"tmdb_payload" IS NULL OR jsonb_typeof("tmdb_payload") = 'object'`,
)
@Check(
  'chk_titles_tmdb_payload_metadata',
  `"tmdb_payload" IS NULL OR (
    "tmdb_id" IS NOT NULL
    AND "tmdb_language" IS NOT NULL
    AND length(btrim("tmdb_language")) > 0
    AND "tmdb_fetched_at" IS NOT NULL
  )`,
)
export class Title {
  @PrimaryGeneratedColumn('identity')
  id!: number;

  @Column({
    type: 'enum',
    enum: TitleType,
    enumName: 'title_type',
  })
  type!: TitleType;

  @Column({
    name: 'tmdb_id',
    type: 'integer',
    nullable: true,
  })
  tmdbId!: number | null;

  @Column({ type: 'text' })
  title!: string;

  @Column({
    name: 'original_title',
    type: 'text',
    nullable: true,
  })
  originalTitle!: string | null;

  @Column({ type: 'text', nullable: true })
  overview!: string | null;

  @Column({
    name: 'release_date',
    type: 'date',
    nullable: true,
  })
  releaseDate!: string | null;

  @Column({
    name: 'poster_path',
    type: 'text',
    nullable: true,
  })
  posterPath!: string | null;

    @Column({
    name: 'backdrop_path',
    type: 'text',
    nullable: true,
  })
  backdropPath!: string | null;

  @Column({ type: 'text', nullable: true })
  tagline!: string | null;

  @Column({
    name: 'runtime_minutes',
    type: 'integer',
    nullable: true,
  })
  runtimeMinutes!: number | null;

  @Column({
    name: 'original_language',
    type: 'text',
    nullable: true,
  })
  originalLanguage!: string | null;

  @Column({ type: 'text', nullable: true })
  status!: string | null;

  @Column({
    name: 'tmdb_payload',
    type: 'jsonb',
    nullable: true,
    select: false,
  })
  tmdbPayload!: Record<string, unknown> | null;

  @Column({
    name: 'tmdb_language',
    type: 'text',
    nullable: true,
  })
  tmdbLanguage!: string | null;

  @Column({
    name: 'tmdb_fetched_at',
    type: 'timestamptz',
    nullable: true,
  })
  tmdbFetchedAt!: Date | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  updatedAt!: Date;
}