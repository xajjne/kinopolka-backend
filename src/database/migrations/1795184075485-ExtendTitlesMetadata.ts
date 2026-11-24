import { MigrationInterface, QueryRunner } from "typeorm";

export class ExtendTitlesMetadata1795184075485 implements MigrationInterface {
    name = 'ExtendTitlesMetadata1795184075485'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "titles" ADD "backdrop_path" text`);
        await queryRunner.query(`ALTER TABLE "titles" ADD "tagline" text`);
        await queryRunner.query(`ALTER TABLE "titles" ADD "runtime_minutes" integer`);
        await queryRunner.query(`ALTER TABLE "titles" ADD "original_language" text`);
        await queryRunner.query(`ALTER TABLE "titles" ADD "status" text`);
        await queryRunner.query(`ALTER TABLE "titles" ADD "tmdb_payload" jsonb`);
        await queryRunner.query(`ALTER TABLE "titles" ADD "tmdb_language" text`);
        await queryRunner.query(`ALTER TABLE "titles" ADD "tmdb_fetched_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "titles" ADD CONSTRAINT "chk_titles_tmdb_payload_metadata" CHECK ("tmdb_payload" IS NULL OR (
    "tmdb_id" IS NOT NULL
    AND "tmdb_language" IS NOT NULL
    AND length(btrim("tmdb_language")) > 0
    AND "tmdb_fetched_at" IS NOT NULL
  ))`);
        await queryRunner.query(`ALTER TABLE "titles" ADD CONSTRAINT "chk_titles_tmdb_payload_object" CHECK ("tmdb_payload" IS NULL OR jsonb_typeof("tmdb_payload") = 'object')`);
        await queryRunner.query(`ALTER TABLE "titles" ADD CONSTRAINT "chk_titles_runtime_positive" CHECK ("runtime_minutes" > 0)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "titles" DROP CONSTRAINT "chk_titles_runtime_positive"`);
        await queryRunner.query(`ALTER TABLE "titles" DROP CONSTRAINT "chk_titles_tmdb_payload_object"`);
        await queryRunner.query(`ALTER TABLE "titles" DROP CONSTRAINT "chk_titles_tmdb_payload_metadata"`);
        await queryRunner.query(`ALTER TABLE "titles" DROP COLUMN "tmdb_fetched_at"`);
        await queryRunner.query(`ALTER TABLE "titles" DROP COLUMN "tmdb_language"`);
        await queryRunner.query(`ALTER TABLE "titles" DROP COLUMN "tmdb_payload"`);
        await queryRunner.query(`ALTER TABLE "titles" DROP COLUMN "status"`);
        await queryRunner.query(`ALTER TABLE "titles" DROP COLUMN "original_language"`);
        await queryRunner.query(`ALTER TABLE "titles" DROP COLUMN "runtime_minutes"`);
        await queryRunner.query(`ALTER TABLE "titles" DROP COLUMN "tagline"`);
        await queryRunner.query(`ALTER TABLE "titles" DROP COLUMN "backdrop_path"`);
    }

}
