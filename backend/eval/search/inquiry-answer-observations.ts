import type { AssistantToolTrace } from '../../src/admin/assistant/assistant.service';
import type { InquirySearchResult } from '../../src/search/search-contract';
import type { InquiryEvalCase } from './inquiry-fixture';

export function inquiryToolObservations(item: InquiryEvalCase, calls: readonly AssistantToolTrace[]) {
  const inquiryCalls = calls.filter(call => call.name === 'summarize_inquiries');
  const dataCalls = inquiryCalls.filter(call => ['ok', 'no_candidates', 'no_data'].includes((call.result as InquirySearchResult).status));
  const matching = dataCalls.filter(call => typeof call.args.query === 'string' && call.args.productId === item.productId &&
    call.args.status === item.status && call.args.startDate === item.startDate && call.args.endDate === item.endDate);
  const last = inquiryCalls.at(-1)?.result as InquirySearchResult | undefined;
  return { scopeMatched: matching.length > 0 && matching.length === dataCalls.length,
    invalidArgumentAttempts: inquiryCalls.filter(call => (call.result as InquirySearchResult).status === 'invalid_arguments').length,
    mismatchedDataCalls: dataCalls.length - matching.length,
    terminalSearchFailure: !!last && ['unavailable', 'indexing', 'invalid_arguments', 'forbidden', 'unsupported'].includes(last.status),
    returnedIds: [...new Set(matching.flatMap(call => (call.result as InquirySearchResult).data?.sources?.map(source => source.id) ?? []))] };
}
