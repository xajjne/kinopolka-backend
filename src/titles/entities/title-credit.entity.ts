import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Person } from './person.entity';
import { Title } from './title.entity';

@Entity('title_credits')
@Index('idx_title_credits_person_title', ['personId', 'titleId'])
@Check('chk_title_credits_kind', "\"kind\" IN ('cast', 'crew')")
@Check('chk_title_credits_entries', 'jsonb_typeof("entries") = \'array\'')
export class TitleCredit {
  @PrimaryColumn({
    name: 'title_id',
    type: 'integer',
    primaryKeyConstraintName: 'pk_title_credits',
  })
  titleId!: number;

  @PrimaryColumn({
    name: 'person_id',
    type: 'integer',
    primaryKeyConstraintName: 'pk_title_credits',
  })
  personId!: number;

  @PrimaryColumn({ type: 'text', primaryKeyConstraintName: 'pk_title_credits' })
  kind!: 'cast' | 'crew';

  @Column({ name: 'sort_order', type: 'integer' })
  sortOrder!: number;

  @Column({ type: 'jsonb' })
  entries!: Record<string, unknown>[];

  @ManyToOne(() => Title, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'title_id',
    foreignKeyConstraintName: 'fk_title_credits_title',
  })
  title!: Title;

  @ManyToOne(() => Person, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'person_id',
    foreignKeyConstraintName: 'fk_title_credits_person',
  })
  person!: Person;
}
