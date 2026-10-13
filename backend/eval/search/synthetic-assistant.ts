import { ConfigService } from '@nestjs/config';
import { AssistantService } from '../../src/admin/assistant/assistant.service';
import { SearchIndexRecorder } from '../../src/search/search-index-recorder';
import { SemanticSearchService } from '../../src/search/semantic-search.service';
import type { EmbeddingClient } from '../../src/intrastructure/ai/embedding-client.interface';
import type { LlmClient } from '../../src/intrastructure/ai/llm-client.interface';
import type { DataSource } from 'typeorm';
import type { EvalReview } from './search-eval-environment';

/** Fixed synthetic domain answers; never bootstrap AppModule or read the user's data. */
export function syntheticAssistant(db: DataSource, reviews: readonly EvalReview[], embeddings: EmbeddingClient, llm: LlmClient) {
  const config = new ConfigService({ AI_SEARCH_REVIEWS_ENABLED: 'true' });
  const search = new SemanticSearchService(db, config, embeddings, new SearchIndexRecorder(config));
  const categories = { getCategoryIdsByName: async (name: string) => ['신발', '뷰티', '의류'].includes(name) ? [1] : [] };
  const products = { getProductIdsByCategoryIds: async () => [...new Set(reviews.map(review => review.productId))],
    findAllAdmin: async (args: { approvalStatus?: string; status?: string }) => ({ data: [{ id: 9001, name: '합성 데모 상품', price: 12000,
      stockQuantity: args.status === 'sold_out' ? 0 : 12, status: args.status ?? 'published', approvalStatus: args.approvalStatus ?? 'approved', category: { name: '신발' } }], meta: { total: 1 } }) };
  const dashboard = {
    getSalesSummary: async (startDate: string, endDate: string) => ({ startDate, endDate, totalRevenue: startDate.startsWith('2020') ? 0 : 120000, orderCount: startDate.startsWith('2020') ? 0 : 10 }),
    getOrderStats: async (startDate: string, endDate: string) => ({ startDate, endDate, total: 10, byStatus: { pending_payment: 0, paid: 2, preparing: 1, shipped: 2, delivered: 3, completed: 2, cancelled: 0 } }),
  };
  const audit = { getAuditLogs: async (args: { action?: string }) => ({ data: [{ id: 1, action: args.action ?? 'FAILED_LOGIN', success: false,
    email: 'synthetic@example.test', ipAddress: '192.0.2.1', createdAt: new Date('2026-06-12T00:00:00Z') }], meta: { total: 1 } }) };
  const reviewService = { getReviewsForAssistant: async (args: { productIds?: number[]; maxRating?: number; startDate?: string; endDate?: string; take?: number }) =>
    reviews.filter(review => (!args.productIds || args.productIds.includes(review.productId)) && (!args.maxRating || review.rating <= args.maxRating) &&
      (!args.startDate || Date.parse(review.createdAt) >= Date.parse(args.startDate)) && (!args.endDate || Date.parse(review.createdAt) <= Date.parse(args.endDate)))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id).slice(0, args.take ?? 30)
      .map(review => ({ id: review.id, productId: review.productId, productName: `합성 상품 ${review.productId}`, rating: review.rating, comment: review.comment, createdAt: new Date(review.createdAt) })) };
  const inquiries = { getInquiriesForAssistant: async () => [{ id: 8001, productId: 101, productName: '합성 상품 101', status: 'waiting', isSecret: false, title: '배송 문의', content: '언제 도착하나요?', answer: null }] };
  const service = new AssistantService(llm, dashboard as never, audit as never, products as never, categories as never, reviewService as never, inquiries as never, {} as never, {} as never, search);
  Object.assign(service, { todayKst: () => '2026-10-13' });
  return service;
}
