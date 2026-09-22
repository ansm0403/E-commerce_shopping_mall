import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Ops Companion Phase 7 — 채점 안내(설계 §9 Phase 7).
 *  - ops_incident_notes: 인시던트별 사실 메모(+ 원인 위치의 실제 코드 조각)
 *  - ops_reviews.guided(기본 false) · checks(jsonb): 안내와 함께 채점했는가 + 확인 항목 4개의 답
 *  - ops_reviews 유니크 (analysis_id, reviewer_id) → (analysis_id, reviewer_id, guided):
 *    기존 행은 DEFAULT false 로 전부 "안내 없는 채점"으로 남고, 안내 채점은 옆에 새 행으로 쌓인다(전/후 비교의 두 쪽)
 *  - ops_analyses.project: 분석 시점의 Sentry 프로젝트 slug(대기 응답의 relatedFiles 정규화 힌트)
 * down 은 guided=true 행이 있으면 옛 유니크 복원에서 실패한다 — 되돌리려면 안내 채점 행을 먼저 지워야 한다.
 */
export class OpsGuidedReview1790079789208 implements MigrationInterface {
    name = 'OpsGuidedReview1790079789208'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ops_reviews" DROP CONSTRAINT "UQ_73be8ee57654ec4c243c062d0d4"`);
        await queryRunner.query(`CREATE TABLE "ops_incident_notes" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "incident_id" character varying(40) NOT NULL, "project" character varying(80), "symptom" text NOT NULL, "cause_location" text NOT NULL, "fix_direction" text NOT NULL, "common_mistakes" text, "code_path" character varying(300), "code_ref" character varying(40), "code_start_line" integer, "code_end_line" integer, "code_text" text, "author_id" integer, CONSTRAINT "UQ_0a8a1029da5e0ec294bc02ad387" UNIQUE ("incident_id"), CONSTRAINT "PK_7105cc32179deabe2be325fe49e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0a8a1029da5e0ec294bc02ad38" ON "ops_incident_notes" ("incident_id") `);
        await queryRunner.query(`ALTER TABLE "ops_reviews" ADD "guided" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "ops_reviews" ADD "checks" jsonb`);
        await queryRunner.query(`ALTER TABLE "ops_analyses" ADD "project" character varying(80)`);
        await queryRunner.query(`ALTER TABLE "ops_reviews" ADD CONSTRAINT "UQ_944482aab7f87912f59f9ce5899" UNIQUE ("analysis_id", "reviewer_id", "guided")`);
        await queryRunner.query(`ALTER TABLE "ops_incident_notes" ADD CONSTRAINT "FK_788300c8580ac62c7554d9d5f5a" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ops_incident_notes" DROP CONSTRAINT "FK_788300c8580ac62c7554d9d5f5a"`);
        await queryRunner.query(`ALTER TABLE "ops_reviews" DROP CONSTRAINT "UQ_944482aab7f87912f59f9ce5899"`);
        await queryRunner.query(`ALTER TABLE "ops_analyses" DROP COLUMN "project"`);
        await queryRunner.query(`ALTER TABLE "ops_reviews" DROP COLUMN "checks"`);
        await queryRunner.query(`ALTER TABLE "ops_reviews" DROP COLUMN "guided"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0a8a1029da5e0ec294bc02ad38"`);
        await queryRunner.query(`DROP TABLE "ops_incident_notes"`);
        await queryRunner.query(`ALTER TABLE "ops_reviews" ADD CONSTRAINT "UQ_73be8ee57654ec4c243c062d0d4" UNIQUE ("analysis_id", "reviewer_id")`);
    }

}
