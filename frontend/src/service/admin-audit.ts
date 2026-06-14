import { authClient } from '../lib/axios/axios-http-client';

// ──────────────────────────────────────────────
// 응답 타입 (백엔드 AuditLogResponseDto / getAuditLogs meta 와 1:1)
// ──────────────────────────────────────────────
export interface AuditLog {
  id: number;
  userId: number | null;
  userNickName: string | null; // §4-2 행위자 보강 (getAuditLogs 가 user 일괄 조인)
  userEmail: string | null;
  action: string;
  ipAddress: string;
  userAgent: string;
  metadata: Record<string, unknown> | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string; // ISO
}

export interface AuditLogMeta {
  total: number;
  page: number;
  lastPage: number;
  take: number;
  hasNextPage: boolean;
}

export interface AuditLogsResponse {
  data: AuditLog[];
  meta: AuditLogMeta;
}

export interface AuditLogQuery {
  page?: number;
  take?: number;
  userId?: number;
  action?: string;
  success?: boolean;
  startDate?: string;
  endDate?: string;
  ipAddress?: string;
}

// ──────────────────────────────────────────────
// API 호출 — 대시보드(service/admin-dashboard.ts)와 동일하게 authClient 사용.
//   GET /admin/audit-logs (전역 prefix /v1 는 axios baseURL 에 포함)
// ──────────────────────────────────────────────
export async function fetchAuditLogs(query: AuditLogQuery) {
  const params: Record<string, string | number> = {};
  if (query.page) params.page = query.page;
  if (query.take) params.take = query.take;
  if (query.userId != null) params.userId = query.userId;
  if (query.action) params.action = query.action;
  // boolean → 'true'/'false' 문자열. 백엔드 DTO 가 raw 쿼리스트링을 읽어 변환한다.
  if (query.success !== undefined) params.success = String(query.success);
  if (query.startDate) params.startDate = query.startDate;
  if (query.endDate) params.endDate = query.endDate;
  if (query.ipAddress) params.ipAddress = query.ipAddress;
  return authClient.get<AuditLogsResponse>('/admin/audit-logs', { params });
}

// ──────────────────────────────────────────────
// action 메타 — 백엔드 AuditAction enum 과 1:1 (shared 에 없어 프론트에서 정의)
// ──────────────────────────────────────────────
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // 인증
  LOGIN: '로그인',
  LOGOUT: '로그아웃',
  REGISTER: '회원가입',
  PASSWORD_CHANGE: '비밀번호 변경',
  TOKEN_REFRESH: '토큰 갱신',
  FAILED_LOGIN: '로그인 실패',
  ACCOUNT_LOCKED: '계정 잠금',
  EMAIL_VERIFIED: '이메일 인증',
  TWO_FACTOR_ENABLED: '2FA 활성화',
  TWO_FACTOR_VERIFIED: '2FA 검증',
  // 주문
  ORDER_CREATED: '주문 생성',
  ORDER_CANCELLED: '주문 취소',
  ORDER_CONFIRMED: '구매 확정',
  // 결제
  PAYMENT_VERIFIED: '결제 검증',
  PAYMENT_CANCELLED: '결제 취소',
  PAYMENT_CANCELLED_ADMIN: '결제 강제취소(관리자)',
  PAYMENT_WEBHOOK: '결제 웹훅',
  // 배송
  SHIPMENT_SHIPPED: '발송',
  SHIPMENT_DELIVERED: '배송 완료',
  // 상품
  PRODUCT_CREATED: '상품 등록',
  PRODUCT_UPDATED: '상품 수정',
  PRODUCT_DELETED: '상품 삭제',
  PRODUCT_APPROVED: '상품 승인',
  PRODUCT_REJECTED: '상품 반려',
  // 셀러
  SELLER_APPROVED: '셀러 승인',
  SELLER_REJECTED: '셀러 반려',
  // 리뷰
  REVIEW_CREATED: '리뷰 작성',
  REVIEW_UPDATED: '리뷰 수정',
  REVIEW_DELETED: '리뷰 삭제',
  // 정산
  SETTLEMENT_CONFIRMED: '정산 확정',
  SETTLEMENT_PAID: '정산 지급',
  // 문의
  INQUIRY_ANSWERED: '문의 답변',
  // 사용자
  PROFILE_UPDATED: '프로필 수정',
  // 크론(시스템)
  CRON_ORDER_EXPIRED: '주문 만료(크론)',
  CRON_SHIPMENT_AUTO_DELIVERED: '자동 배송완료(크론)',
  CRON_ORDER_AUTO_COMPLETED: '자동 구매확정(크론)',
};

/** 셀렉트 옵션용 전체 action 목록 */
export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABELS);

/**
 * 트리아지 🟡 "관리자 행위(책임추적)" 버킷에 모을 action 집합.
 * 백엔드가 action IN 을 지원하지 않으므로(§4-3) 프론트가 action 별로 N번 호출해 합산한다.
 */
export const ADMIN_ACTOR_ACTIONS = [
  'SELLER_APPROVED',
  'PRODUCT_APPROVED',
  'PRODUCT_REJECTED',
  'PAYMENT_CANCELLED_ADMIN',
  'SETTLEMENT_CONFIRMED',
  'SETTLEMENT_PAID',
];

export function actionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
