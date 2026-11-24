import { Check, Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { TitleType } from './title.entity';

@Entity('genres')
@Unique('uq_genres_type_tmdb_id', ['type', 'tmdbId'])
@Check('chk_genres_tmdb_id_positive', '"tmdb_id" > 0')
@Check('chk_genres_name_not_blank', 'length(btrim("name")) > 0')
export class Genre {
  @PrimaryGeneratedColumn('identity')
  id!: number;

  @Column({ type: 'enum', enum: TitleType, enumName: 'title_type' })
  type!: TitleType;

  @Column({ name: 'tmdb_id', type: 'integer' })
  tmdbId!: number;

  @Column({ type: 'text' })
  name!: string;
}
