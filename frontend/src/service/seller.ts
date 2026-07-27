import type { ApplySellerRequest, SellerApplication } from '@shopping-mall/shared';
import { authClient } from '../lib/axios/axios-http-client';

/**
 * 셀러 신청/상태 조회 (01-seller-core §1-A①).
 *   POST /seller/apply  (BUYER 전용)
 *   GET  /seller/me     (BUYER·SELLER) — 신청 내역이 없으면 404
 *
 * 은행 3필드는 신청할 때만 보낸다. 응답(SellerEntity)에서는 @Exclude 라 돌아오지 않으므로
 * 재신청 시에도 다시 입력받아야 한다.
 */

export async function applySeller(dto: ApplySellerRequest) {
  return authClient.post<{ message: string }>('/seller/apply', dto);
}

export async function getMySellerInfo() {
  return authClient.get<SellerApplication>('/seller/me');
}

/**
 * 선택 필드(contactEmail·contactPhone)의 빈 문자열을 제거한다.
 * 백엔드가 `@IsOptional() @IsEmail()` 이라 빈 문자열을 보내면 400 — undefined 여야 통과.
 */
export function stripEmptyOptionals(dto: ApplySellerRequest): ApplySellerRequest {
  const cleaned: ApplySellerRequest = { ...dto };
  if (!cleaned.contactEmail?.trim()) delete cleaned.contactEmail;
  if (!cleaned.contactPhone?.trim()) delete cleaned.contactPhone;
  return cleaned;
}
