import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { AssistantService } from '../../src/admin/assistant/assistant.service';
import { maskAssistantValue } from '../../src/admin/assistant/assistant-masking';
import type { EmbeddingClient } from '../../src/intrastructure/ai/embedding-client.interface';
import type { LlmClient } from '../../src/intrastructure/ai/llm-client.interface';
import { SemanticSearchService } from '../../src/search/semantic-search.service';
import { SearchIndexRecorder } from '../../src/search/search-index-recorder';
import { INITIAL_SEARCH_PROFILE as PROFILE } from '../../src/search/search-profile';
import type { EvalInquiry } from './search-eval-environment';

/** Probe DB and synthetic source data only; never initialize AppModule or customer repositories. */
export function syntheticInquiryAssistant(db: DataSource, corpus: readonly EvalInquiry[], embeddings: EmbeddingClient, llm: LlmClient) {
  const config = new ConfigService({ AI_SEARCH_REVIEWS_ENABLED: 'false', AI_SEARCH_INQUIRIES_ENABLED: 'true', AI_SEARCH_PROFILE_ID: PROFILE.id });
  const search = new SemanticSearchService(db, config, embeddings, new SearchIndexRecorder(config));
  const ids = [...new Set(corpus.map(source => source.productId))];
  const products = { getProductIdsByCategoryIds: async () => ids,
    findAllAdmin: async () => ({ data: ids.map(id => ({ id, name: `합성 상품 ${id}`, category: { name: '합성 평가' } })), meta: { total: ids.length } }) };
  const inquiries = { getInquiriesForAssistant: async (filter: { productIds?: number[]; status?: string; startDate?: string; endDate?: string; take?: number }) =>
    corpus.filter(source => !source.isSecret && (!filter.productIds || filter.productIds.includes(source.productId)) && (!filter.status || source.status === filter.status) &&
      (!filter.startDate || Date.parse(source.createdAt) >= Date.parse(filter.startDate)) && (!filter.endDate || Date.parse(source.createdAt) <= Date.parse(filter.endDate)))
      .slice(0, filter.take ?? 30).map(source => maskAssistantValue({ ...source, createdAt: new Date(source.createdAt) })) };
  const service = new AssistantService(llm,
    { getSalesSummary: async () => ({ totalRevenue: 0, orderCount: 0 }), getOrderStats: async () => ({ total: 0, byStatus: {} }) } as never,
    { getAuditLogs: async () => ({ data: [], meta: { total: 0 } }) } as never, products as never,
    { getCategoryIdsByName: async (name: string) => name === '합성 평가' ? [1] : [] } as never,
    { getReviewsForAssistant: async () => [] } as never, inquiries as never, {} as never, {} as never, search);
  Object.assign(service, { todayKst: () => '2026-10-14' });
  return { service, search };
}
