import { MigrationInterface, QueryRunner } from 'typeorm';
export class ModerationAndRatings1795450500000 implements MigrationInterface {
  async up(r: QueryRunner) {
    await r.query(
      'ALTER TABLE accounts ADD is_admin boolean NOT NULL DEFAULT false, ADD suspended boolean NOT NULL DEFAULT false',
    );
    await r.query(
      'ALTER TABLE collections ADD hidden boolean NOT NULL DEFAULT false',
    );
    await r.query(`INSERT INTO collection_titles(collection_id,title_id,position)
 SELECT c.id,p.id,row_number() OVER(PARTITION BY c.id ORDER BY p.rank DESC NULLS LAST,p.id)
 FROM collections c CROSS JOIN LATERAL (
 SELECT t.id,CASE WHEN c.id='space' THEN (t.tmdb_payload->>'popularity')::float8 ELSE (t.tmdb_payload->>'vote_average')::float8 END AS rank
 FROM titles t WHERE t.type::text=CASE c.id WHEN 'space' THEN 'movie' ELSE 'series' END
 AND EXISTS(SELECT 1 FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id AND lower(g.name)=CASE c.id WHEN 'space' THEN 'фантастика' ELSE 'детектив' END)
 ORDER BY rank DESC NULLS LAST,t.id LIMIT 12) p
 WHERE c.id IN ('space','mystery') AND NOT EXISTS(SELECT 1 FROM collection_titles l WHERE l.collection_id=c.id)`);
    await r.query(`CREATE TABLE external_ratings(title_id integer REFERENCES titles ON DELETE CASCADE,
 source text CHECK(source IN ('kinopoisk','seriesgraph')), score numeric(4,2) NOT NULL CHECK(score>0 AND score<=10),
 url text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(title_id,source))`);
  }
  async down(r: QueryRunner) {
    await r.query('DROP TABLE external_ratings');
    await r.query('ALTER TABLE collections DROP hidden');
    await r.query('ALTER TABLE accounts DROP suspended,DROP is_admin');
  }
}
