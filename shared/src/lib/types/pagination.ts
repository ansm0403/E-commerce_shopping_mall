/**
 * 페이지 기반 페이지네이션 응답 (백엔드 CommonService.pagePaginate 반환과 1:1).
 * 커서 기반은 meta 모양이 달라(`count/hasNext/nextCursor`) 별도로 둔다.
 */
export interface PageMeta {
  total: number;
  page: number;
  lastPage: number;
  take: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PageMeta;
}
