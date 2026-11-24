import { MigrationInterface, QueryRunner } from 'typeorm';

export class TitleReviews1795450400000 implements MigrationInterface {
  async up(r: QueryRunner) {
    await r.query(`ALTER TABLE title_comments ADD headline varchar(120),
      ADD spoiler boolean NOT NULL DEFAULT false`);
    await r.query(`CREATE UNIQUE INDEX title_review_author ON title_comments(title_id,account_id)
      WHERE headline IS NOT NULL`);
    await r.query(`CREATE TABLE episode_views (
      title_id integer REFERENCES titles ON DELETE CASCADE, season integer CHECK(season>=0),
      episode integer CHECK(episode>0), account_id integer REFERENCES accounts ON DELETE CASCADE,
      PRIMARY KEY(title_id,season,episode,account_id))`);
    await r.query(`CREATE TABLE review_reactions (
      comment_id integer REFERENCES title_comments ON DELETE CASCADE,
      account_id integer REFERENCES accounts ON DELETE CASCADE,
      kind text NOT NULL CHECK(kind IN ('like','dislike')), PRIMARY KEY(comment_id,account_id))`);
  }
  async down(r: QueryRunner) {
    await r.query('DROP TABLE review_reactions, episode_views');
    await r.query('DROP INDEX title_review_author');
    await r.query(
      'ALTER TABLE title_comments DROP COLUMN headline, DROP COLUMN spoiler',
    );
  }
}
