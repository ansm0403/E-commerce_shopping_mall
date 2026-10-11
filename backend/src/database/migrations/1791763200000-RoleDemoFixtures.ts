import { MigrationInterface, QueryRunner } from 'typeorm';

export class RoleDemoFixtures1791763200000 implements MigrationInterface {
  name = 'RoleDemoFixtures1791763200000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE demo_fixtures (
      id SERIAL PRIMARY KEY, scope varchar NOT NULL, fixture_key varchar NOT NULL,
      order_id integer UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
      inquiry_id integer UNIQUE REFERENCES inquiries(id) ON DELETE RESTRICT,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT demo_fixture_slot UNIQUE(scope, fixture_key),
      CONSTRAINT demo_fixture_target CHECK ((order_id IS NULL) <> (inquiry_id IS NULL))
    )`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(
      'SELECT count(*)::int AS count FROM demo_fixtures'
    );
    if (count)
      throw new Error(
        '체험 데이터가 남아 있어 식별 테이블을 제거할 수 없습니다. 먼저 데이터 정리 계획을 적용하세요.'
      );
    await queryRunner.query('DROP TABLE demo_fixtures');
  }
}
