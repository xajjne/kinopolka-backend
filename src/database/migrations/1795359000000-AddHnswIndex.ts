import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHnswIndex1795359000000 implements MigrationInterface {
  name = 'AddHnswIndex1795359000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "idx_title_embeddings_hnsw_cosine"
      ON "title_embeddings" USING hnsw ("embedding" vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "idx_title_embeddings_hnsw_cosine"');
  }
}
