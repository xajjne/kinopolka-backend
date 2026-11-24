import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateEpisodeRatings1795450200000 implements MigrationInterface {
  async up(r: QueryRunner) {
    await r.query(`CREATE TABLE episode_ratings (
 title_id integer REFERENCES titles ON DELETE CASCADE, season integer CHECK(season>=0),
 episode integer CHECK(episode>0), account_id integer REFERENCES accounts ON DELETE CASCADE,
 rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 10), PRIMARY KEY(title_id,season,episode,account_id))`);
  }
  async down(r: QueryRunner) {
    await r.query('DROP TABLE episode_ratings');
  }
}
