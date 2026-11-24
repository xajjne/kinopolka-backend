import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTitleEmbeddings1795277900060 implements MigrationInterface {
    name = 'CreateTitleEmbeddings1795277900060'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "title_embeddings" ("title_id" integer NOT NULL, "model_name" text NOT NULL, "model_revision" text NOT NULL, "text_version" integer NOT NULL, "source_text" text NOT NULL, "source_hash" character varying(64) NOT NULL, "embedding" vector(1024) NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_title_embeddings_source_hash" CHECK ("source_hash" ~ '^[0-9a-f]{64}$'), CONSTRAINT "chk_title_embeddings_text_version_positive" CHECK ("text_version" > 0), CONSTRAINT "chk_title_embeddings_revision_not_blank" CHECK (length(btrim("model_revision")) > 0), CONSTRAINT "chk_title_embeddings_model_not_blank" CHECK (length(btrim("model_name")) > 0), CONSTRAINT "chk_title_embeddings_source_not_blank" CHECK (length(btrim("source_text")) > 0), CONSTRAINT "pk_title_embeddings" PRIMARY KEY ("title_id"))`);
        await queryRunner.query(`ALTER TABLE "title_embeddings" ADD CONSTRAINT "fk_title_embeddings_title" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "title_embeddings" DROP CONSTRAINT "fk_title_embeddings_title"`);
        await queryRunner.query(`DROP TABLE "title_embeddings"`);
    }

}
