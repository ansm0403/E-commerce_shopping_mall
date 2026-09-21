import { MigrationInterface, QueryRunner } from "typeorm";

export class OpsReviews1790001959888 implements MigrationInterface {
    name = 'OpsReviews1790001959888'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "ops_reviews" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "analysis_id" integer NOT NULL, "reviewer_id" integer NOT NULL, "verdict" character varying(10) NOT NULL, "rating" smallint, "comment" text, CONSTRAINT "UQ_73be8ee57654ec4c243c062d0d4" UNIQUE ("analysis_id", "reviewer_id"), CONSTRAINT "PK_808f1ec4228a65da2378144426f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_876c85814244854360e954c28f" ON "ops_reviews" ("analysis_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_cf294ae84bb5cb2d3016fb5c15" ON "ops_reviews" ("reviewer_id") `);
        await queryRunner.query(`ALTER TABLE "ops_analyses" ADD "incident_title" character varying(300)`);
        await queryRunner.query(`ALTER TABLE "ops_analyses" ADD "exception_text" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "ops_analyses" ADD "few_shot_ids" jsonb`);
        await queryRunner.query(`ALTER TABLE "ops_reviews" ADD CONSTRAINT "FK_876c85814244854360e954c28f9" FOREIGN KEY ("analysis_id") REFERENCES "ops_analyses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ops_reviews" ADD CONSTRAINT "FK_cf294ae84bb5cb2d3016fb5c15d" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ops_reviews" DROP CONSTRAINT "FK_cf294ae84bb5cb2d3016fb5c15d"`);
        await queryRunner.query(`ALTER TABLE "ops_reviews" DROP CONSTRAINT "FK_876c85814244854360e954c28f9"`);
        await queryRunner.query(`ALTER TABLE "ops_analyses" DROP COLUMN "few_shot_ids"`);
        await queryRunner.query(`ALTER TABLE "ops_analyses" DROP COLUMN "exception_text"`);
        await queryRunner.query(`ALTER TABLE "ops_analyses" DROP COLUMN "incident_title"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cf294ae84bb5cb2d3016fb5c15"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_876c85814244854360e954c28f"`);
        await queryRunner.query(`DROP TABLE "ops_reviews"`);
    }

}
