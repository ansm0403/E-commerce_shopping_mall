import type { LlmToolDef } from '../../intrastructure/ai/llm-client.interface';

/**
 * 어시스턴트가 노출하는 도구 정의(프로바이더 비종속 LlmToolDef).
 * "무엇을 할 수 있는가"의 데이터 선언만 둔다 — 실제 실행(디스패치)은 AssistantService가 소유.
 *
 * description은 모델이 "언제 이 도구를 쓸지" 판단하는 근거 → 트리거 조건을 명확히 적는다.
 */

export const SALES_SUMMARY_TOOL: LlmToolDef = {
  name: 'get_sales_summary',
  description:
    '특정 기간(시작일~종료일, 양끝 포함)의 결제 완료 매출 합계(원)와 주문 건수를 조회한다. ' +
    '사용자가 매출/판매액/거래액/주문 수를 물을 때 사용한다. 날짜는 반드시 YYYY-MM-DD 형식.',
  parameters: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: '조회 시작일 (YYYY-MM-DD, 포함)' },
      endDate: { type: 'string', description: '조회 종료일 (YYYY-MM-DD, 포함)' },
    },
    required: ['startDate', 'endDate'],
  },
};

export const ORDER_STATS_TOOL: LlmToolDef = {
  name: 'get_order_stats',
  description:
    '특정 기간(시작일~종료일, 양끝 포함) 동안 생성된 주문을 상태별로 집계한다. ' +
    '상태값: pending_payment(결제대기), paid(결제완료), preparing(상품준비), shipped(배송중), ' +
    'delivered(배송완료), completed(구매확정), cancelled(취소). ' +
    '주문 건수·상태 분포·주문 추이를 물을 때 사용한다. 날짜는 반드시 YYYY-MM-DD 형식.',
  parameters: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: '조회 시작일 (YYYY-MM-DD, 포함)' },
      endDate: { type: 'string', description: '조회 종료일 (YYYY-MM-DD, 포함)' },
    },
    required: ['startDate', 'endDate'],
  },
};

export const QUERY_AUDIT_LOGS_TOOL: LlmToolDef = {
  name: 'query_audit_logs',
  description:
    '감사 로그(보안·인증·주문·상품 등 시스템 활동 기록)를 조건으로 검색한다. ' +
    '로그인 실패/계정 잠금 등 의심스러운 활동 분석, 특정 액션 발생 내역 조회에 사용한다. ' +
    '대표 action: LOGIN, FAILED_LOGIN, ACCOUNT_LOCKED, ORDER_CREATED, ORDER_CANCELLED, ' +
    'PAYMENT_VERIFIED, PRODUCT_APPROVED, SELLER_APPROVED 등. ' +
    '결과의 이메일·IP는 개인정보 보호를 위해 마스킹(***)되어 반환된다. ' +
    '정확한 총 건수는 meta.total 값을 사용한다. data 배열은 최근 take건(기본 50, 최대 100)만 ' +
    '포함하므로, total이 take보다 크면 "모두/전부" 같은 단정 대신 표본 기준임을 밝힌다.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '필터할 액션명(예: FAILED_LOGIN). 생략 시 전체 액션.',
      },
      success: {
        type: 'boolean',
        description: '성공/실패 여부 필터. 실패 로그만 보려면 false.',
      },
      userId: { type: 'number', description: '특정 사용자 ID로 필터(선택).' },
      startDate: {
        type: 'string',
        description: '조회 시작 일시(ISO 8601, 예: 2026-06-01). 생략 가능.',
      },
      endDate: {
        type: 'string',
        description: '조회 종료 일시(ISO 8601). 생략 가능.',
      },
      take: {
        type: 'number',
        description: '가져올 최대 건수(기본 50, 최대 100).',
      },
    },
    required: [],
  },
};

export const GET_PRODUCT_INFO_TOOL: LlmToolDef = {
  name: 'get_product_info',
  description:
    '상품 목록을 상태별로 조회한다(이름·가격·재고·판매 상태·승인 상태). 모든 상태(승인 대기/거절 포함)를 본다. ' +
    '승인 대기 상품 목록, 거절된 상품, 특정 셀러의 상품, 품절/숨김 상품 등을 물을 때 사용한다. ' +
    'approvalStatus: pending(승인대기), approved(승인됨), rejected(거절됨). ' +
    'status: draft, published(판매중), sold_out(품절), hidden(숨김), discontinued(단종).',
  parameters: {
    type: 'object',
    properties: {
      approvalStatus: {
        type: 'string',
        description: '승인 상태 필터: pending | approved | rejected (선택).',
      },
      status: {
        type: 'string',
        description: '판매 상태 필터: draft | published | sold_out | hidden | discontinued (선택).',
      },
      sellerId: { type: 'number', description: '특정 셀러 ID로 필터(선택).' },
      take: {
        type: 'number',
        description: '가져올 최대 건수(기본 20, 최대 50).',
      },
    },
    required: [],
  },
};

/** 어시스턴트에 등록되는 전체 도구 목록. (Phase 4 확장) */
export const ASSISTANT_TOOLS: LlmToolDef[] = [
  SALES_SUMMARY_TOOL,
  ORDER_STATS_TOOL,
  QUERY_AUDIT_LOGS_TOOL,
  GET_PRODUCT_INFO_TOOL,
];
