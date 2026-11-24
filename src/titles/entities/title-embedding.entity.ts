import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Title } from './title.entity';

@Entity('title_embeddings')
@Index('idx_title_embeddings_hnsw_cosine', { synchronize: false })
@Check(
  'chk_title_embeddings_source_not_blank',
  'length(btrim("source_text")) > 0',
)
@Check(
  'chk_title_embeddings_model_not_blank',
  'length(btrim("model_name")) > 0',
)
@Check(
  'chk_title_embeddings_revision_not_blank',
  'length(btrim("model_revision")) > 0',
)
@Check('chk_title_embeddings_text_version_positive', '"text_version" > 0')
@Check('chk_title_embeddings_source_hash', `"source_hash" ~ '^[0-9a-f]{64}$'`)
export class TitleEmbedding {
  @PrimaryColumn({
    name: 'title_id',
    type: 'integer',
    primaryKeyConstraintName: 'pk_title_embeddings',
  })
  titleId!: number;

  @OneToOne(() => Title, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'title_id',
    foreignKeyConstraintName: 'fk_title_embeddings_title',
  })
  title!: Title;

  @Column({ name: 'model_name', type: 'text' })
  modelName!: string;

  @Column({ name: 'model_revision', type: 'text' })
  modelRevision!: string;

  @Column({ name: 'text_version', type: 'integer' })
  textVersion!: number;

  @Column({ name: 'source_text', type: 'text' })
  sourceText!: string;

  @Column({ name: 'source_hash', type: 'varchar', length: 64 })
  sourceHash!: string;

  @Column({ type: 'vector', length: 1024, select: false })
  embedding!: number[];

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  updatedAt!: Date;
}
