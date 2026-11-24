import {
  Check,
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('people')
@Unique('uq_people_tmdb_id', ['tmdbId'])
@Check('chk_people_tmdb_id_positive', '"tmdb_id" > 0')
@Check('chk_people_name_not_blank', 'length(btrim("name")) > 0')
@Check(
  'chk_people_payload_object',
  '"tmdb_payload" IS NULL OR jsonb_typeof("tmdb_payload") = \'object\'',
)
export class Person {
  @PrimaryGeneratedColumn('identity')
  id!: number;

  @Column({ name: 'tmdb_id', type: 'integer' })
  tmdbId!: number;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'profile_path', type: 'text', nullable: true })
  profilePath!: string | null;

  @Column({
    name: 'tmdb_payload',
    type: 'jsonb',
    nullable: true,
    select: false,
  })
  tmdbPayload!: Record<string, unknown> | null;

  @Column({ name: 'tmdb_fetched_at', type: 'timestamptz', nullable: true })
  tmdbFetchedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
