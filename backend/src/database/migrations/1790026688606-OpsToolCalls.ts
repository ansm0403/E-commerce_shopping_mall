import { MigrationInterface, QueryRunner } from "typeorm";

export class OpsToolCalls1790026688606 implements MigrationInterface {
    name = 'OpsToolCalls1790026688606'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ops_analyses" ADD "tool_calls" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ops_analyses" DROP COLUMN "tool_calls"`);
    }

}
