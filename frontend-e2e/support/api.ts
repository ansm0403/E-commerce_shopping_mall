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

/** 주문서 화면과 같은 배송비 규칙(frontend checkout/page.tsx SHIPPING_FEE · FREE_SHIPPING_THRESHOLD) */
export const SHIPPING_FEE = 3000;
export const FREE_SHIPPING_THRESHOLD = 50000;
export function expectedTotal(subtotal: number): number {
  return subtotal + (subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE);
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
