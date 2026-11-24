import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateAccountsAndShelf1795450000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE accounts (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      nickname text NOT NULL UNIQUE CHECK(nickname ~ '^[a-z_]{1,40}$'),
      password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE account_sessions (
      token_hash char(64) PRIMARY KEY, account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL)`);
    await q.query(
      'CREATE INDEX account_sessions_owner ON account_sessions(account_id)',
    );
    await q.query(
      'CREATE INDEX account_sessions_expiry ON account_sessions(expires_at)',
    );
    await q.query(`CREATE TABLE shelf_entries (
      account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title_id integer NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      status text CHECK(status IN ('watching','planned','watched','paused','dropped')),
      favorite boolean NOT NULL DEFAULT false, rating smallint CHECK(rating BETWEEN 1 AND 10),
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,title_id))`);
    await q.query(`CREATE TABLE title_comments (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title_id integer NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 2000),
      created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(
      'CREATE INDEX title_comments_page ON title_comments(title_id,id DESC)',
    );
    await q.query(
      'CREATE INDEX title_comments_author ON title_comments(account_id)',
    );
    await q.query(
      'CREATE INDEX shelf_entries_title ON shelf_entries(title_id)',
    );
  }
  async down(q: QueryRunner) {
    await q.query(
      'DROP TABLE title_comments, shelf_entries, account_sessions, accounts',
    );
  }
}
