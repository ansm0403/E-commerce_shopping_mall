import type { Page } from '@playwright/test';
import { resetLoginRateLimits } from '../../backend-e2e/src/support/redis';
import { E2E_PASSWORD } from './api';

/**
 * 로그인 화면의 폼으로 로그인한다(데모 버튼이 아니라 실제 이메일·비밀번호 경로). 끝나면 /login 을 벗어난 상태.
 * 로그인은 IP 당 10회/5분 제한이라, 스펙이 쌓이면 브라우저 로그인이 429("너무 많은 로그인 시도")로 막힌다 —
 * 백엔드 e2e 와 같은 방식으로 직전에 카운터를 비운다(첫 실행에서 8번째 로그인부터 실패했다).
 */
export async function loginViaForm(page: Page, email: string, password = E2E_PASSWORD): Promise<void> {
  await resetLoginRateLimits();
  await page.goto('/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

/** alert/confirm 을 자동으로 닫고 문구를 모아 둔다 — 결제창 실패 안내처럼 "떴는지" 를 단언할 때 쓴다 */
export function autoDismissDialogs(page: Page): string[] {
  const messages: string[] = [];
  page.on('dialog', (dialog) => {
    messages.push(dialog.message());
    void dialog.dismiss();
  });
  return messages;
}
