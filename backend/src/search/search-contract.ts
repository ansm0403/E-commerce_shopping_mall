export type SearchStatus = 'ok' | 'no_data' | 'no_candidates' | 'indexing' | 'unavailable' | 'invalid_arguments' | 'forbidden' | 'unsupported';
export interface ReviewSearchScope {
  sourceType: 'review';
  timezone: 'Asia/Seoul';
  unit: 'source';
  profileId: string;
  query?: string;
  productIds?: number[];
  categoryIds?: number[];
  categoryName?: string;
  maxRating?: number;
  startDate?: string;
  endDate?: string;
  take?: number;
  checkedAt?: string;
}
export interface SearchCoverage { total: number; ready: number; pending: number; failed: number; partial: boolean; }
export interface ReviewSearchSource {
  sourceType: 'review'; id: number; productId: number; createdAt: string; rating: number;
  quotes: { chunkIndex: number; text: string }[];
}
export interface ReviewSearchResult {
  status: SearchStatus;
  mode: 'semantic';
  scope: ReviewSearchScope;
  data: { sources: ReviewSearchSource[]; candidateChunkCount: number; omittedSourceCount: number; contextTruncated: boolean };
  coverage: SearchCoverage | null;
  error: { code: string; message: string } | null;
}

export interface InquirySearchScope extends Omit<ReviewSearchScope, 'sourceType' | 'maxRating'> {
  sourceType: 'inquiry';
  status?: 'waiting' | 'answered';
}
export interface InquirySearchSource {
  sourceType: 'inquiry'; id: number; productId: number; createdAt: string;
  status: 'waiting' | 'answered'; title: string;
  hasContent: boolean; hasAnswer: boolean;
  quotes: { chunkIndex: number; text: string }[];
}
export interface InquirySearchResult extends Omit<ReviewSearchResult, 'scope' | 'data'> {
  scope: InquirySearchScope;
  data: { sources: InquirySearchSource[]; candidateChunkCount: number; omittedSourceCount: number; contextTruncated: boolean };
}

export const SEARCH_MESSAGES = {
  forbidden: '관리자 권한이 필요합니다. 권한 재시도로 데이터를 조회하지 마세요.',
  unsupported: '리뷰 의미 검색이 활성화되지 않았습니다.',
  invalid_arguments: '허용된 인자와 범위를 확인하세요.',
  unavailable: '검색을 수행할 수 없습니다. 원본 데이터가 없다는 뜻은 아닙니다.',
  indexing: '조건에 맞는 원본의 색인이 아직 반영 중입니다.',
} as const;

export function searchFailure(status: keyof typeof SEARCH_MESSAGES, code: string, scope: ReviewSearchScope, coverage: SearchCoverage | null = null): ReviewSearchResult {
  return { status, mode: 'semantic', scope, data: { sources: [], candidateChunkCount: 0, omittedSourceCount: 0, contextTruncated: false }, coverage,
    error: { code, message: SEARCH_MESSAGES[status] } };
}

export function inquirySearchFailure(status: keyof typeof SEARCH_MESSAGES, code: string, scope: InquirySearchScope, coverage: SearchCoverage | null = null): InquirySearchResult {
  return { status, mode: 'semantic', scope, data: { sources: [], candidateChunkCount: 0, omittedSourceCount: 0, contextTruncated: false }, coverage,
    error: { code, message: status === 'unsupported' ? '공개 문의 의미 검색이 활성화되지 않았습니다.' : SEARCH_MESSAGES[status] } };
}
