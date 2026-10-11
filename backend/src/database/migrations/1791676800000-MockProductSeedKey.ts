import { MigrationInterface, QueryRunner } from 'typeorm';

export class MockProductSeedKey1791676800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE products ADD COLUMN seed_key varchar UNIQUE');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE products DROP COLUMN seed_key');
  }
}
