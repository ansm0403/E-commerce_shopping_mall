import { z } from 'zod';
import { isCalendarDate, searchDay as day, searchQuery, MAX_SEARCH_QUERY_CODE_POINTS } from '../../search/search-input';
import { AuditAction } from '../../audit/entity/audit-log.entity';

export const positiveId = z.number().int().min(1).max(2147483647);
const auditDate = z.string().max(64).refine(value => isCalendarDate(value) ||
  (/^\d{4}-\d{2}-\d{2}T/.test(value) && isCalendarDate(value.slice(0, 10)) && z.iso.datetime({ offset: true }).safeParse(value).success))
  .describe('실재하는 YYYY-MM-DD 또는 시간대가 있는 ISO 8601 시각.');
const categoryName = z.string().trim().min(1).max(200).describe('카테고리 이름, 하위 포함. productId와 함께 주면 productId 우선.');
const range = { startDate: day.optional(), endDate: day.optional() };
const reviewFields = { productId: positiveId.optional(), categoryName: categoryName.optional(), maxRating: z.number().int().min(1).max(5).optional(), ...range };
const inquiryFields = { productId: positiveId.optional(), categoryName: categoryName.optional(), status: z.enum(['waiting', 'answered']).optional(),
  startDate: day.describe('문의 작성일 조회 시작일(KST, 포함). 시작과 끝을 지정한 기간 질문은 startDate와 endDate를 반드시 함께 전달한다.').optional(),
  endDate: day.describe('문의 작성일 조회 종료일(KST, 포함). 오늘 날짜와 같아도 생략하지 않는다. 10월 1일부터 12일까지는 startDate=YYYY-10-01, endDate=YYYY-10-12.').optional(),
};
export const legacyReviewsSchema = z.strictObject({ ...reviewFields, take: z.number().int().min(1).max(50).optional().describe('기존 조건 조회 기본 30, 최대 50.') });
export const semanticReviewsSchema = z.strictObject({ ...reviewFields,
  query: searchQuery,
  take: z.number().int().min(1).max(10).optional().describe('의미 검색 원본 수. 기본 5, 최대 10.'),
});
export const legacyInquiriesSchema = z.strictObject({ ...inquiryFields, take: z.number().int().min(1).max(50).optional() });
export const semanticInquiriesSchema = z.strictObject({ ...inquiryFields, query: searchQuery, take: z.number().int().min(1).max(10).optional() });
const datePair = z.strictObject({ startDate: day, endDate: day });
export const ASSISTANT_TOOL_SCHEMAS = {
  get_sales_summary: datePair,
  get_order_stats: datePair,
  query_audit_logs: z.strictObject({ action: z.enum(AuditAction).optional().describe('감사 이벤트 종류. 로그인 실패=FAILED_LOGIN, 계정 잠금=ACCOUNT_LOCKED, 정상 로그인=LOGIN.'), success: z.boolean().optional(), userId: positiveId.optional(),
    startDate: auditDate.optional(), endDate: auditDate.optional(), take: z.number().int().min(1).max(100).optional() }),
  get_product_info: z.strictObject({ approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
    status: z.enum(['draft', 'published', 'sold_out', 'hidden', 'discontinued']).optional(), sellerId: positiveId.optional(), take: z.number().int().min(1).max(50).optional() }),
  summarize_reviews: z.union([legacyReviewsSchema, semanticReviewsSchema]),
  summarize_inquiries: z.union([legacyInquiriesSchema, semanticInquiriesSchema]),
};
export type AssistantToolName = keyof typeof ASSISTANT_TOOL_SCHEMAS;
export type ReviewToolArguments = z.infer<typeof ASSISTANT_TOOL_SCHEMAS.summarize_reviews>;

/** JSON Schema and runtime parsing share the same definitions. Cross-field date order is checked below. */
export function toolParameters(name: AssistantToolName, semanticReviewsEnabled = false, semanticInquiriesEnabled = false): Record<string, unknown> {
  // Keep a single object schema at the provider boundary; conditional take is still enforced by the union parser.
  const schema = name === 'summarize_reviews' ? (semanticReviewsEnabled ? semanticReviewsSchema.partial({ query: true }).extend({ take: z.number().int().min(1).max(50).optional().describe('query가 있으면 1..10, 기본 5. query가 없으면 1..50, 기본 30.') }) : legacyReviewsSchema)
    : name === 'summarize_inquiries' ? (semanticInquiriesEnabled ? semanticInquiriesSchema.partial({ query: true }).extend({ take: z.number().int().min(1).max(50).optional().describe('query가 있으면 1..10, 기본 5. query가 없으면 1..50, 기본 30.') }) : legacyInquiriesSchema)
    : ASSISTANT_TOOL_SCHEMAS[name];
  const json = z.toJSONSchema(schema, { io: 'input', target: 'draft-7', override: context => {
    // JSON Schema counts Unicode characters; JS String.length counts UTF-16 code units.
    if (context.zodSchema === searchQuery) context.jsonSchema.maxLength = MAX_SEARCH_QUERY_CODE_POINTS;
  } });
  const parameters = { ...json };
  delete parameters.$schema;
  return parameters;
}

export function parseToolArguments(name: string, args: unknown): { success: true; data: Record<string, unknown> } | { success: false; code: string } {
  if (!Object.hasOwn(ASSISTANT_TOOL_SCHEMAS, name)) return { success: false, code: 'UNKNOWN_TOOL' };
  const parsed = ASSISTANT_TOOL_SCHEMAS[name as AssistantToolName].safeParse(args);
  if (!parsed.success) return { success: false, code: 'INVALID_ARGUMENTS' };
  const values = parsed.data as Record<string, unknown>;
  if (values.startDate && values.endDate && new Date(normalizeToolDate(String(values.startDate), false)).getTime() > new Date(normalizeToolDate(String(values.endDate), true)).getTime()) {
    return { success: false, code: 'INVALID_DATE_RANGE' };
  }
  return { success: true, data: values };
}

export function normalizeToolDate(value: string, end: boolean): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${end ? '23:59:59.999' : '00:00:00.000'}+09:00` : value;
}
