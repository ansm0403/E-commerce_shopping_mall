/* eslint-disable */
// 백엔드 e2e 하네스의 준비 헬퍼를 그대로 쓴다 — 계정·상품·주문은 "검증 대상"이 아니라 "준비"라서 HTTP·DB 로 만든다.
// test-setup 은 import 만으로 axios.defaults(baseURL http://localhost:4000/v1, validateStatus 통과)를 설정한다.
import '../../backend-e2e/src/support/test-setup';
import axios from 'axios';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auth } from '../../backend-e2e/src/support/commerce';

export { loginRaw, login } from '../../backend-e2e/src/support/login';
export { addToCart, createOrder, auth } from '../../backend-e2e/src/support/commerce';
export {
  createDataSource,
  simulatePaidOrder,
  E2E_PASSWORD,
  e2ePrefix,
  makeEmails,
} from '../../backend-e2e/src/support/db';

/** 이 스위트의 이름공간 — 계정 이메일·상품명이 전부 `e2e-fe-checkout-` 로 시작한다 */
export const SUITE = 'fe-checkout';

/**
 * 화면이 보여야 하는 총 결제금액 = 서버 규칙(order.service.ts: 항목 합계, 배송비 없음).
 * 2026-10-16 첫 실행 전까지 화면은 5만 원 미만에 3,000원을 더했고(22,900원) 서버는 19,900원을 청구했다 —
 * 결정 (a)(ex-frontend-e2e.md §4, 2026-10-21): 화면을 서버에 맞춰 배송비 줄은 "무료". 이 함수가 다시 더하기 시작하면 서버와 어긋난다.
 */
export const SHIPPING_LABEL = '무료';
export function expectedTotal(subtotal: number): number {
  return subtotal;
}
/** 화면 표기와 같은 금액 문자열 — toLocaleString() → "22,900원" */
export function won(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

export type Fixtures = {
  buyer: string;
  seller: string;
  admin: string;
  productId: number;
  productName: string;
  price: number;
};

// global-setup(별 프로세스)이 만든 값을 워커가 읽는 통로 — 파일 하나
const STATE_DIR = join(__dirname, '..', '.state');
const STATE_FILE = join(STATE_DIR, 'fixtures.json');

export function writeFixtures(fixtures: Fixtures): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(fixtures, null, 2));
}

export function readFixtures(): Fixtures {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Fixtures;
}

/** 구매자 장바구니 비우기 — 스펙마다 "담긴 것 1개" 에서 출발하게 */
export async function clearCart(buyerToken: string): Promise<void> {
  const res = await axios.delete('/cart', auth(buyerToken));
  if (res.status !== 200 && res.status !== 204) {
    throw new Error(`장바구니 비우기 실패 ${res.status} ${JSON.stringify(res.data)}`);
  }
}
