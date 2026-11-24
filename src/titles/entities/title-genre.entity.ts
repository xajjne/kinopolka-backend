import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Genre } from './genre.entity';
import { Title } from './title.entity';

@Entity('title_genres')
@Index('idx_title_genres_genre_title', ['genreId', 'titleId'])
export class TitleGenre {
  @PrimaryColumn({
    name: 'title_id',
    type: 'integer',
    primaryKeyConstraintName: 'pk_title_genres',
  })
  titleId!: number;

  @PrimaryColumn({
    name: 'genre_id',
    type: 'integer',
    primaryKeyConstraintName: 'pk_title_genres',
  })
  genreId!: number;

  @ManyToOne(() => Title, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'title_id',
    foreignKeyConstraintName: 'fk_title_genres_title',
  })
  title!: Title;

  @ManyToOne(() => Genre, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'genre_id',
    foreignKeyConstraintName: 'fk_title_genres_genre',
  })
  genre!: Genre;
}
