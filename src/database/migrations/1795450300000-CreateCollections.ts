import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateCollections1795450300000 implements MigrationInterface {
  async up(r: QueryRunner) {
    await r.query(
      `CREATE TABLE collections(id text PRIMARY KEY, owner integer REFERENCES accounts ON DELETE CASCADE, name text NOT NULL, description text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now())`,
    );
    await r.query(
      "INSERT INTO collections(id,name) VALUES ('space','Миры фантастики'),('mystery','Детективные сериалы')",
    );
    await r.query(
      `CREATE TABLE collection_titles(collection_id text REFERENCES collections ON DELETE CASCADE,title_id integer REFERENCES titles ON DELETE CASCADE,position integer NOT NULL CHECK(position>0),PRIMARY KEY(collection_id,title_id),UNIQUE(collection_id,position))`,
    );
    await r.query(
      `CREATE TABLE collection_bookmarks(account_id integer REFERENCES accounts ON DELETE CASCADE,collection_id text REFERENCES collections ON DELETE CASCADE,PRIMARY KEY(account_id,collection_id))`,
    );
    await r.query(
      'CREATE INDEX collection_bookmarks_by_collection ON collection_bookmarks(collection_id)',
    );
    await r.query('ALTER TABLE accounts ADD COLUMN profile jsonb');
  }
  async down(r: QueryRunner) {
    await r.query('ALTER TABLE accounts DROP COLUMN profile');
    await r.query(
      'DROP TABLE collection_bookmarks,collection_titles,collections',
    );
  }
}
