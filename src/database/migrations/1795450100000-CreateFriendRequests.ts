import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateFriendRequests1795450100000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE friend_requests (
    sender integer REFERENCES accounts(id) ON DELETE CASCADE,
    recipient integer REFERENCES accounts(id) ON DELETE CASCADE,
    PRIMARY KEY(sender,recipient), CHECK(sender<>recipient))`);
  }
  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE friend_requests');
  }
}
