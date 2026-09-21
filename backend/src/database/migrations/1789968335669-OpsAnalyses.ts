import { MigrationInterface, QueryRunner } from "typeorm";

export class OpsAnalyses1789968335669 implements MigrationInterface {
    name = 'OpsAnalyses1789968335669'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "ops_analyses" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "incident_id" character varying(40) NOT NULL, "status" character varying(20) NOT NULL, "result_json" jsonb, "raw_text" text, "prompt_version" character varying(20) NOT NULL, "model" character varying(80), "latency_ms" integer NOT NULL, CONSTRAINT "PK_2bbf3a317f9b9153758677865a1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c61ed3f79710d207f2da484da2" ON "ops_analyses" ("incident_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_c61ed3f79710d207f2da484da2"`);
        await queryRunner.query(`DROP TABLE "ops_analyses"`);
    }

}
