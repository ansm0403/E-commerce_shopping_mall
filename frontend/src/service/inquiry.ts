import { AxiosError } from 'axios';
import type {
  AnswerInquiryRequest,
  CreateInquiryRequest,
  InquiryResponse,
  InquiryStatus,
  PaginatedResponse,
} from '@shopping-mall/shared';
import { publicClient, authClient } from '../lib/axios/axios-http-client';

/**
 * 목록은 전부 페이지 기반으로 부른다 — `page` 를 빼면 백엔드가 커서 모드로 응답해 `meta.total` 이 없다.
 */
export interface InquiryPageParams {
  page?: number;
  take?: number;
}

const withPage = ({ page = 1, take = 20 }: InquiryPageParams = {}) => ({ page, take });

// ─── 공개 (상품 상세 탭) ──────────────────────────────────────────────────────

/**
 * 상품별 문의 목록. 비밀 문의는 서버가 마스킹해서 준다.
 * `auth: true` 면 Bearer 를 실어 보내 **작성자 본인의 비밀글만** 풀린다(백엔드 OptionalJwtAuthGuard).
 * 토큰이 만료돼 있어도 서버는 401 을 내지 않고 비로그인으로 취급한다 — 공개 목록 때문에 로그아웃되지 않는다.
 */
export function getProductInquiries(
  productId: number,
  params: InquiryPageParams = {},
  { auth = false }: { auth?: boolean } = {},
) {
  const client = auth ? authClient : publicClient;
  return client.get<PaginatedResponse<InquiryResponse>>(`/inquiries/product/${productId}`, {
    params: withPage(params),
  });
}

// ─── 구매자 (authClient, BUYER) ───────────────────────────────────────────────

export function createInquiry(body: CreateInquiryRequest) {
  return authClient.post<InquiryResponse>('/inquiries', body);
}

/** 내 문의 목록 — 상품명(`product`) 포함 */
export function getMyInquiries(params: InquiryPageParams = {}) {
  return authClient.get<PaginatedResponse<InquiryResponse>>('/inquiries/my', {
    params: withPage(params),
  });
}

/** 본인 문의 삭제 — 답변 완료된 문의는 서버가 400 */
export function deleteInquiry(id: number) {
  return authClient.delete<{ message: string }>(`/inquiries/${id}`);
}

// ─── 셀러 (authClient, SELLER) ────────────────────────────────────────────────

/** 내 상품에 달린 문의 — `status` 를 빼면 전체. 상품명(`product`) 포함 */
export function getSellerInquiries(
  params: InquiryPageParams & { status?: InquiryStatus } = {},
) {
  const { status, ...page } = params;
  return authClient.get<PaginatedResponse<InquiryResponse>>('/seller/inquiries', {
    params: { ...withPage(page), ...(status ? { status } : {}) },
  });
}

/** 답변 등록 — 한 번만 가능(이미 답변됐으면 400), 남의 상품 문의는 403 */
export function answerInquiry(id: number, body: AnswerInquiryRequest) {
  return authClient.patch<InquiryResponse>(`/seller/inquiries/${id}/answer`, body);
}

/** 서버 에러 → 화면 문구. 백엔드가 준 message 를 최대한 살린다. */
export function inquiryErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('\n');
    if (error.response?.status === 403) return '이 작업을 할 권한이 없습니다.';
  }
  return '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
}
