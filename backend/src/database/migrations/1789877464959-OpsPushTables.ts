import { MigrationInterface, QueryRunner } from "typeorm";

export class OpsPushTables1789877464959 implements MigrationInterface {
    name = 'OpsPushTables1789877464959'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "ops_push_log" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "incident_id" character varying(40) NOT NULL, "user_id" integer NOT NULL, "last_pushed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "push_count" integer NOT NULL DEFAULT '1', CONSTRAINT "UQ_321cd583201173a91a13a4eaa73" UNIQUE ("incident_id", "user_id"), CONSTRAINT "PK_7ef261f9f766f5f03cf16ee632a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_dcb13fccb136f32e942db77ab8" ON "ops_push_log" ("incident_id") `);
        await queryRunner.query(`CREATE TABLE "ops_device_tokens" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "user_id" integer NOT NULL, "expo_push_token" character varying(200) NOT NULL, "platform" character varying(10) NOT NULL, "disabled_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_e2be5d29fe67d146568b0f35377" UNIQUE ("user_id", "expo_push_token"), CONSTRAINT "PK_fec60bf0cfa312a69101b5d8b17" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7d378d2ac5452ddf93a2382c19" ON "ops_device_tokens" ("user_id") `);
        await queryRunner.query(`CREATE TABLE "ops_poll_state" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "source" character varying(30) NOT NULL DEFAULT 'sentry', "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_issue_id" character varying(40), CONSTRAINT "UQ_5345940fa554cdca655564d5e41" UNIQUE ("source"), CONSTRAINT "PK_fd11d491f208d90b9d75b0db200" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "ops_device_tokens" ADD CONSTRAINT "FK_7d378d2ac5452ddf93a2382c19b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ops_device_tokens" DROP CONSTRAINT "FK_7d378d2ac5452ddf93a2382c19b"`);
        await queryRunner.query(`DROP TABLE "ops_poll_state"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7d378d2ac5452ddf93a2382c19"`);
        await queryRunner.query(`DROP TABLE "ops_device_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dcb13fccb136f32e942db77ab8"`);
        await queryRunner.query(`DROP TABLE "ops_push_log"`);
    }

}
