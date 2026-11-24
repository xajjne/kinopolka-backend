import {
  Check,
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Title } from './title.entity';

@Entity('title_media')
@Check('chk_title_media_payload_object', 'jsonb_typeof("payload") = \'object\'')
export class TitleMedia {
  @PrimaryColumn({
    name: 'title_id',
    type: 'integer',
    primaryKeyConstraintName: 'pk_title_media',
  })
  titleId!: number;

  @Column({ type: 'jsonb', select: false })
  payload!: Record<string, unknown>;

  @UpdateDateColumn({ name: 'fetched_at', type: 'timestamptz' })
  fetchedAt!: Date;

  @OneToOne(() => Title, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'title_id',
    foreignKeyConstraintName: 'fk_title_media_title',
  })
  title!: Title;
}
