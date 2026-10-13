import type { LlmToolDef } from '../../intrastructure/ai/llm-client.interface';
import { AssistantToolName, toolParameters } from './assistant-tool-schemas';

const tool = (name: AssistantToolName, description: string): LlmToolDef => ({ name, description, parameters: toolParameters(name) });
export const SALES_SUMMARY_TOOL = tool('get_sales_summary', '기간의 결제 완료 매출 합계(원)와 주문 건수를 조회한다. 매출·판매액·거래액·주문 수 질문에 사용한다. 날짜 YYYY-MM-DD, 양끝 포함 KST.');
export const ORDER_STATS_TOOL = tool('get_order_stats', '기간에 생성된 주문을 상태별로 집계한다. pending_payment, paid, preparing, shipped, delivered, completed, cancelled. 주문 상태 분포 질문에 사용한다. 날짜 YYYY-MM-DD, 양끝 포함 KST.');
export const QUERY_AUDIT_LOGS_TOOL = tool('query_audit_logs', '감사 로그를 action·success·userId·기간으로 조회한다. 보안·로그인 실패·계정 잠금·시스템 활동 분석에 사용한다. 이메일·IP·연락처는 마스킹된다. 정확한 총 건수는 meta.total이다. data는 최근 표본(기본 50, 최대 100)이므로 전체라고 단정하지 않는다.');
export const GET_PRODUCT_INFO_TOOL = tool('get_product_info', '관리자 상품 목록의 이름·가격·재고·판매·승인 상태를 조회한다. 승인 대기·거절·품절·숨김을 포함한다. approvalStatus: pending/approved/rejected. status: draft/published/sold_out/hidden/discontinued. sellerId 필터 지원. 기본 20, 최대 50.');
const reviewDescription = '고객 리뷰 텍스트를 상품(productId 우선) 또는 카테고리(categoryName, 하위 포함), 평점 상한·기간으로 모아 요약·분석한다. 최근 부정 리뷰 요약에는 maxRating=2를 사용한다. 브랜드·가격대·작성자 조건은 지원하지 않는다. 작성자 신원은 반환하지 않고 연락처를 마스킹한다. 날짜 YYYY-MM-DD, 양끝 포함 KST. query 없는 조건 조회는 기본 30, 최대 50이며 count는 표본이다.';
export const SUMMARIZE_REVIEWS_TOOL = tool('summarize_reviews', reviewDescription);
const inquiryDescription = '고객 문의(Q&A)를 상품(productId 우선) 또는 카테고리(categoryName, 하위 포함), status(waiting/answered), 기간으로 모아 요약한다. 브랜드·가격대·작성자 조건은 지원하지 않는다. 작성자 신원은 반환하지 않고 연락처를 마스킹한다. 비밀 문의는 제목·본문·답변을 제외한 메타 정보만 반환한다. 날짜 YYYY-MM-DD, 양끝 포함 KST. 기본 30, 최대 50; count는 표본이다.';
export const SUMMARIZE_INQUIRIES_TOOL = tool('summarize_inquiries', inquiryDescription);
export const ASSISTANT_TOOLS: LlmToolDef[] = [SALES_SUMMARY_TOOL, ORDER_STATS_TOOL, QUERY_AUDIT_LOGS_TOOL, GET_PRODUCT_INFO_TOOL, SUMMARIZE_REVIEWS_TOOL, SUMMARIZE_INQUIRIES_TOOL];

/** Inactive query capability is absent from both schema and tool guidance. */
export function assistantTools(semanticReviewsEnabled: boolean, semanticInquiriesEnabled = false): LlmToolDef[] {
  return ASSISTANT_TOOLS.map(definition => definition.name === 'summarize_reviews' && semanticReviewsEnabled ? {
    ...definition,
    description: reviewDescription.replace('최근 부정 리뷰 요약에는 maxRating=2를 사용한다.', 'query 없이 최근 저평점·부정 리뷰를 요약할 때 maxRating=2를 사용한다.') + ' query를 주면 표현이 다른 관련 리뷰를 의미 검색한다(기본 원본 5개, 최대 10개). 내용 불만 검색의 긍정/부정은 별점이 아닌 본문으로 판단한다. 사용자가 별점을 명시하지 않으면 maxRating을 추가하지 않는다. 같은 현상의 다른 표현도 인용한다. 명시한 날짜 양끝을 전달한다. 결과 status·coverage.partial을 확인하고 리뷰 #ID와 실제 인용으로 답한다.',
    parameters: toolParameters('summarize_reviews', true),
  } : definition.name === 'summarize_inquiries' && semanticInquiriesEnabled ? {
    ...definition,
    description: inquiryDescription + ' query를 주면 공개 문의의 제목·본문·답변을 의미 검색한다(기본 원본 5개, 최대 10개). 비밀 문의는 원본·청크·coverage 모두에서 제외한다. 미지정 기간이나 상태를 임의로 추가하지 않는다. 명시한 기간은 시작과 종료일을 함께 넣는다(예: 2026년 10월 1일부터 12일까지 → startDate=2026-10-01, endDate=2026-10-12). 제목·고객 본문·판매자 답변을 구분하고 문의 #ID와 실제 인용으로 답한다. 본문/답변 존재 여부는 hasContent/hasAnswer를 따른다. 문제를 실제로 겪지 않았다는 원문을 불만 근거로 사용하지 않는다. 답변 예정·안내를 실제 배송 완료 사실로 바꾸지 않는다. 관련 근거가 없으면 가져온 자료 기준임을 밝힌다.',
    parameters: toolParameters('summarize_inquiries', false, true),
  } : definition);
}
