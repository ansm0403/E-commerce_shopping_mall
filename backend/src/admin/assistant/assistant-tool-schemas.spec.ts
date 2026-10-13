import { assistantTools } from './assistant-tools';
import { parseToolArguments as parse } from './assistant-tool-schemas';

describe('assistant model arguments', () => {
  it.each(['constructor', 'toString', '__proto__'])('rejects the inherited name %s as an unknown tool', name => {
    expect(parse(name, {})).toEqual({ success: false, code: 'UNKNOWN_TOOL' });
  });
  it.each([
    ['summarize_reviews', { query: ' ', take: 5 }], ['summarize_reviews', { query: 'q', take: 11 }],
    ['summarize_reviews', { take: 51 }], ['summarize_reviews', { productId: '1' }], ['summarize_reviews', { productId: 0 }],
    ['summarize_reviews', { productIds: [1] }], ['summarize_reviews', { actorId: 1 }], ['summarize_reviews', { roles: ['admin'] }],
    ['summarize_reviews', { sql: 'SELECT *' }], ['summarize_reviews', { maxRating: 2.5 }], ['summarize_reviews', { categoryName: ' ' }],
    ['summarize_reviews', { startDate: '2026-02-30' }], ['summarize_reviews', { startDate: '2026-13-01' }],
    ['summarize_reviews', { startDate: '2026-10-14', endDate: '2026-10-13' }], ['summarize_inquiries', { query: 'q', take: 11 }],
    ['get_product_info', { status: 'unknown' }], ['get_product_info', { approvalStatus: 'unknown' }],
    ['query_audit_logs', { success: 'false' }], ['query_audit_logs', { take: -1 }], ['query_audit_logs', { startDate: '2026-02-30T12:00:00+09:00' }],
    ['query_audit_logs', { action: 'login' }], ['query_audit_logs', { action: 'account_lockout' }],
    ['query_audit_logs', { startDate: '2026-10-13T12:00:00' }], ['get_sales_summary', { startDate: '2026-06-01' }],
    ['get_order_stats', { startDate: '2026-06-01', endDate: '2026-06-30', owner: 'admin' }],
  ].map(([name, args]) => ({ name: name as string, args })))('rejects malformed model input %#', ({ name, args }) => {
    expect(parse(name, args).success).toBe(false);
  });

  it('keeps existing filters, whole-day dates, and the separate semantic/legacy limits', () => {
    expect(parse('summarize_reviews', { take: 50, maxRating: 2, startDate: '2024-02-29' }).success).toBe(true);
    expect(parse('summarize_reviews', { query: '😀'.repeat(1000), take: 10 }).success).toBe(true);
    expect(parse('summarize_reviews', { query: '😀'.repeat(1001) }).success).toBe(false);
    expect(parse('query_audit_logs', { success: false, startDate: '2026-10-13T10:00:00+09:00' }).success).toBe(true);
    expect(parse('query_audit_logs', { action: 'FAILED_LOGIN' }).success).toBe(true);
  });

  it('publishes only active query capability and schemas generated with strict properties', () => {
    const get = (enabled: boolean) => assistantTools(enabled).find(tool => tool.name === 'summarize_reviews')!;
    expect((get(false).parameters.properties as object)).not.toHaveProperty('query');
    expect((get(true).parameters.properties as object)).toHaveProperty('query');
    expect((get(true).parameters.properties as Record<string, { maxLength?: number }>).query.maxLength).toBe(1000);
    expect(get(true).parameters.additionalProperties).toBe(false);
    expect(assistantTools(false).map(tool => tool.name)).toEqual(assistantTools(true).map(tool => tool.name));
  });

  it('activates inquiry query schema independently and keeps legacy/semantic limits separate', () => {
    const get = (reviews: boolean, inquiries: boolean) => assistantTools(reviews, inquiries).find(tool => tool.name === 'summarize_inquiries')!;
    expect(get(true, false).parameters.properties).not.toHaveProperty('query');
    expect(get(false, true).parameters.properties).toHaveProperty('query');
    expect(get(false, true).parameters.additionalProperties).toBe(false);
    expect(parse('summarize_inquiries', { query: 'q', status: 'answered', take: 10 }).success).toBe(true);
    expect(parse('summarize_inquiries', { take: 50 }).success).toBe(true);
    expect(parse('summarize_inquiries', { query: '😀'.repeat(1000) }).success).toBe(true);
    expect(parse('summarize_inquiries', { query: '😀'.repeat(1001) }).success).toBe(false);
  });

  it.each([{ query: '' }, { query: 'q', isSecret: true }, { query: 'q', status: 'closed' }, { query: 'q', maxRating: 2 }, { query: 'q', actorId: 1 }])
    ('rejects unsupported inquiry query fields and scope %#', args => {
      expect(parse('summarize_inquiries', args).success).toBe(false);
    });
});
