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

/** 어시스턴트에 등록되는 전체 도구 목록. (Phase 4에서 확장) */
export const ASSISTANT_TOOLS: LlmToolDef[] = [SALES_SUMMARY_TOOL];
