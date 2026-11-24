import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Keyword } from './keyword.entity';
import { Title } from './title.entity';

@Entity('title_keywords')
@Index('idx_title_keywords_keyword_title', ['keywordId', 'titleId'])
export class TitleKeyword {
  @PrimaryColumn({
    name: 'title_id',
    type: 'integer',
    primaryKeyConstraintName: 'pk_title_keywords',
  })
  titleId!: number;

  @PrimaryColumn({
    name: 'keyword_id',
    type: 'integer',
    primaryKeyConstraintName: 'pk_title_keywords',
  })
  keywordId!: number;

  @ManyToOne(() => Title, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'title_id',
    foreignKeyConstraintName: 'fk_title_keywords_title',
  })
  title!: Title;

  @ManyToOne(() => Keyword, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'keyword_id',
    foreignKeyConstraintName: 'fk_title_keywords_keyword',
  })
  keyword!: Keyword;
}
