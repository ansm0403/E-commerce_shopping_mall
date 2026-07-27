/* eslint-disable */
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

/**
 * e2e 계정 프로비저닝.
 *
 * 왜 DB 를 직접 건드리나 — HTTP 만으로는 이 시나리오를 만들 수 없다.
 *   · 비데모 ADMIN 을 만드는 API 가 없다(역할 부여 엔드포인트 자체가 없음).
 *   · 회원가입은 isEmailVerified=false 로 저장되고, 로그인이 그걸 막는다(auth.service.ts login).
 * 그래서 "계정 준비"만 DB 로 하고, 검증 대상인 신청·승인·조회는 전부 실제 HTTP 로 통과시킨다.
 *
 * 대상 DB 는 실행 중인 서버가 쓰는 그 DB(루트 .env). 그래서 뒷정리를 반드시 한다 —
 * 이 스위트가 만든 계정은 이메일이 전부 E2E_EMAIL_PREFIX 로 시작한다.
 */

loadEnv({ path: join(__dirname, '../../../.env') });

export const E2E_PASSWORD = 'E2eTest123!';

/**
 * 스펙 파일마다 자기 이름공간(suite)을 갖는다.
 *
 * jest 는 테스트 파일을 기본적으로 병렬 실행한다. 스펙들이 같은 계정을 공유하면
 * 한쪽의 beforeAll 청소가 다른 쪽 계정을 지워 버린다 — runInBand 설정 하나에
 * 정합성을 걸어두는 대신, 이름공간을 나눠 스펙끼리 독립시킨다.
 */
export function e2ePrefix(suite: string): string {
  return `e2e-${suite}-`;
}

export function makeEmails(suite: string) {
  const p = e2ePrefix(suite);
  return {
    buyerApprove: `${p}buyer-approve@test.local`,
    buyerReject: `${p}buyer-reject@test.local`,
    admin: `${p}admin@test.local`,
    demoAdmin: `${p}demo-admin@test.local`,
  };
}

export function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5432,
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });
}

/**
 * 유저 1명 생성(이미 있으면 지우고 새로) + 역할 부여.
 * 컬럼명은 TypeORM 기본 네이밍(프로퍼티명 그대로)이라 camelCase 는 따옴표가 필요하다.
 */
export async function createUser(
  ds: DataSource,
  opts: { email: string; role: 'buyer' | 'seller' | 'admin'; isDemo?: boolean },
): Promise<number> {
  const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);

  const [user] = await ds.query(
    `INSERT INTO users (email, password, "nickName", "phoneNumber", address, "isEmailVerified", is_demo)
     VALUES ($1, $2, $3, '01000000000', '서울시 테스트구', true, $4)
     RETURNING id`,
    [opts.email, passwordHash, opts.email.split('@')[0].slice(0, 20), opts.isDemo ?? false],
  );

  const [role] = await ds.query(`SELECT id FROM roles WHERE name = $1`, [opts.role]);
  if (!role) {
    throw new Error(
      `roles 테이블에 '${opts.role}' 이 없습니다. 백엔드가 최소 한 번 부팅되어 role 시드가 돌았는지 확인하세요.`,
    );
  }

  await ds.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [user.id, role.id]);
  return user.id;
}

/**
 * 승인 대기 상품 1건 생성.
 * `isEvent` 는 NOT NULL 인데 DB 기본값이 없어 반드시 넣어야 하고,
 * status/approval_status 는 엔티티 기본값(draft/pending)에 맡긴다.
 */
export async function createPendingProduct(
  ds: DataSource,
  opts: { name: string; sellerId?: number | null },
): Promise<number> {
  const [product] = await ds.query(
    `INSERT INTO products (name, description, price, brand, "stockQuantity", "isEvent", seller_id)
     VALUES ($1, 'e2e 검증용 상품입니다.', 19900, 'e2e브랜드', 10, false, $2)
     RETURNING id`,
    [opts.name, opts.sellerId ?? null],
  );
  return product.id;
}

/** 이름 접두로 e2e 상품을 지운다(계정과 무관하게 남을 수 있어 별도 정리). */
export async function cleanupE2eProducts(ds: DataSource, suite: string): Promise<void> {
  await ds.query(`DELETE FROM products WHERE name LIKE $1`, [`${e2ePrefix(suite)}%`]);
}

/** 해당 스펙이 만든 계정과 그에 딸린 레코드를 전부 지운다(실행 전·후 모두 호출). */
export async function cleanupE2eData(ds: DataSource, suite: string): Promise<void> {
  const like = `${e2ePrefix(suite)}%`;
  const ids: Array<{ id: number }> = await ds.query(
    `SELECT id FROM users WHERE email LIKE $1`,
    [like],
  );
  if (ids.length === 0) return;

  const userIds = ids.map((r) => r.id);
  // 자식 → 부모 순서. audit_logs·refresh_tokens 는 FK 가 없더라도 남기면 노이즈라 함께 정리.
  await ds.query(`DELETE FROM sellers WHERE user_id = ANY($1)`, [userIds]);
  await ds.query(`DELETE FROM refresh_tokens WHERE "userId" = ANY($1)`, [userIds]);
  await ds.query(`DELETE FROM audit_logs WHERE "userId" = ANY($1)`, [userIds]);
  await ds.query(`DELETE FROM user_roles WHERE user_id = ANY($1)`, [userIds]);
  await ds.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
}
