import { Check, Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('keywords')
@Unique('uq_keywords_tmdb_id', ['tmdbId'])
@Check('chk_keywords_tmdb_id_positive', '"tmdb_id" > 0')
@Check('chk_keywords_name_not_blank', 'length(btrim("name")) > 0')
export class Keyword {
  @PrimaryGeneratedColumn('identity')
  id!: number;

  @Column({ name: 'tmdb_id', type: 'integer' })
  tmdbId!: number;

  @Column({ type: 'text' })
  name!: string;
}
