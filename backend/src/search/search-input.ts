import { z } from 'zod';

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export const searchDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate)
  .describe('실재하는 YYYY-MM-DD 날짜. KST 하루 전체를 포함한다.');
export const MAX_SEARCH_QUERY_CODE_POINTS = 1000;
export const searchQuery = z.string().trim().min(1).max(MAX_SEARCH_QUERY_CODE_POINTS * 2).refine(value => Array.from(value).length <= MAX_SEARCH_QUERY_CODE_POINTS)
  .describe('의미 검색 문구. 최대 1000 Unicode 코드 포인트. 불만을 저평점으로 자동 변환하지 않는다.');
const id = z.number().int().min(1).max(2147483647);
export const reviewSearchInput = z.strictObject({
  query: searchQuery,
  productIds: z.array(id).max(10000).optional(),
  categoryIds: z.array(id).max(10000).optional(),
  categoryName: z.string().trim().min(1).max(200).optional(),
  maxRating: z.number().int().min(1).max(5).optional(),
  startDate: searchDay.optional(), endDate: searchDay.optional(),
  take: z.number().int().min(1).max(10).optional(),
}).refine(value => !value.startDate || !value.endDate || value.startDate <= value.endDate)
  .refine(value => !value.categoryName || value.categoryIds !== undefined);
export type ReviewSearchInput = z.infer<typeof reviewSearchInput>;

export const inquirySearchInput = z.strictObject({
  query: searchQuery,
  productIds: z.array(id).max(10000).optional(),
  categoryIds: z.array(id).max(10000).optional(),
  categoryName: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['waiting', 'answered']).optional(),
  startDate: searchDay.optional(), endDate: searchDay.optional(),
  take: z.number().int().min(1).max(10).optional(),
}).refine(value => !value.startDate || !value.endDate || value.startDate <= value.endDate)
  .refine(value => !value.categoryName || value.categoryIds !== undefined);
export type InquirySearchInput = z.infer<typeof inquirySearchInput>;

export function kstDayStart(day: string): string { return `${day}T00:00:00.000+09:00`; }
export function kstDayEndExclusive(day: string): string { return new Date(Date.parse(kstDayStart(day)) + 86400000).toISOString(); }
