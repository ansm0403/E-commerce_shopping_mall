import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { SearchIndexRecorder } from './search-index-recorder';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';

// Explicit defaults keep source-registration tests independent of local .env flags.
const createConfig = (flags: Record<string, string> = {}) => new ConfigService({
  AI_SEARCH_REVIEW_INDEX_ENABLED: 'false',
  AI_SEARCH_INQUIRY_INDEX_ENABLED: 'false',
  AI_SEARCH_PROFILE_ID: PROFILE.id,
  ...flags,
});

describe('search index registration flags', () => {
  it('does not query an unmigrated DB when indexing is disabled', async () => {
    const recorder = new SearchIndexRecorder(createConfig({ AI_SEARCH_REVIEW_INDEX_ENABLED: 'false' }));
    const query = jest.fn();
    const manager = { query } as unknown as EntityManager;
    expect(await recorder.recordReview(manager, 1)).toBe(false);
    await recorder.advanceReview(manager, 1);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires the caller transaction before recording an enabled job', async () => {
    const recorder = new SearchIndexRecorder(createConfig({ AI_SEARCH_REVIEW_INDEX_ENABLED: 'true' }));
    await expect(recorder.recordReview({} as EntityManager, 1)).rejects.toThrow('SEARCH_JOB_REQUIRES_TRANSACTION');
  });
});

describe('inquiry source registration and privacy invalidation', () => {
  const createManager = (query: jest.Mock) => ({
    query, queryRunner: { isTransactionActive: true },
    connection: { options: { schema: 'isolated_inquiry' }, driver: { escape: (name: string) => `"${name.replace(/"/g, '""')}"` } },
  } as unknown as EntityManager);
  const profile = { model: PROFILE.model, dimensions: PROFILE.dimensions, settings: PROFILE };

  it('does not query an unmigrated database to record a disabled inquiry job', async () => {
    const query = jest.fn();
    const recorder = new SearchIndexRecorder(createConfig());
    expect(await recorder.recordInquiry(createManager(query), 1)).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([false, true])('requires a source transaction for %s forced recording', async force => {
    const recorder = new SearchIndexRecorder(createConfig({ AI_SEARCH_INQUIRY_INDEX_ENABLED: 'true' }));
    await expect(recorder.recordInquiry({} as EntityManager, 1, force)).rejects.toThrow('SEARCH_JOB_REQUIRES_TRANSACTION');
    await expect(recorder.advanceInquiry({} as EntityManager, 1)).rejects.toThrow('SEARCH_JOB_REQUIRES_TRANSACTION');
  });

  it.each([false, true])('records only a public source using its database bigint version (force=%s)', async force => {
    const query = jest.fn().mockResolvedValueOnce([profile]).mockResolvedValueOnce([{ is_secret: false }]).mockResolvedValueOnce([{ id: '5' }]);
    const recorder = new SearchIndexRecorder(createConfig({ AI_SEARCH_INQUIRY_INDEX_ENABLED: force ? 'false' : 'true' }));
    expect(await recorder.recordInquiry(createManager(query), 12, force)).toBe(true);
    expect(query.mock.calls[1][0]).toContain('SELECT is_secret');
    expect(query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(query.mock.calls[2][0]).toContain('SELECT id,search_version,$2');
    expect(query.mock.calls[2][0]).toContain('AND is_secret=false');
    expect(query.mock.calls[2][0]).toContain('ON CONFLICT (inquiry_id,source_version,profile_id) DO NOTHING');
    expect(query.mock.calls[2][1]).toEqual([12, PROFILE.id]);
  });

  it('does not create a second job for an already registered public inquiry', async () => {
    const query = jest.fn().mockResolvedValueOnce([profile]).mockResolvedValueOnce([{ is_secret: false }]).mockResolvedValueOnce([]);
    const recorder = new SearchIndexRecorder(createConfig({ AI_SEARCH_INQUIRY_INDEX_ENABLED: 'true' }));
    expect(await recorder.recordInquiry(createManager(query), 12)).toBe(false);
  });

  it('does not create a job or evidence for a source which has been deleted', async () => {
    const query = jest.fn().mockResolvedValueOnce([profile]).mockResolvedValueOnce([]);
    const recorder = new SearchIndexRecorder(createConfig({ AI_SEARCH_INQUIRY_INDEX_ENABLED: 'true' }));
    expect(await recorder.recordInquiry(createManager(query), 12)).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('removes secret evidence and supersedes unfinished work without creating a new job (force=%s)', async force => {
    const query = jest.fn().mockResolvedValueOnce([profile]).mockResolvedValueOnce([{ is_secret: true }]).mockResolvedValue([]);
    const recorder = new SearchIndexRecorder(createConfig({ AI_SEARCH_INQUIRY_INDEX_ENABLED: force ? 'false' : 'true' }));
    expect(await recorder.recordInquiry(createManager(query), 12, force)).toBe(false);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(query.mock.calls[1][0]).not.toMatch(/title|content|answer/);
    expect(query.mock.calls[2][0]).toContain('DELETE FROM');
    expect(query.mock.calls[2][0]).not.toContain('profile_id');
    expect(query.mock.calls[3][0]).toContain("status='superseded',lease_token=NULL");
    expect(query.mock.calls[3][0]).toContain("j.status IN ('pending','running')");
    expect(query.mock.calls.flatMap(call => call[0])).not.toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO')]));
  });

  it('skips metadata invalidation on an unmigrated disabled database without triggering transaction errors', async () => {
    const query = jest.fn().mockResolvedValue([{ available: false }]);
    const recorder = new SearchIndexRecorder(createConfig());
    await recorder.advanceInquiry(createManager(query), 12);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('SELECT to_regclass($1) IS NOT NULL AS available', ['"isolated_inquiry"."inquiry_search_chunks"']);
  });

  it('advances version and removes all secret profiles even when indexing is disabled', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ available: true }]).mockResolvedValue([]);
    const recorder = new SearchIndexRecorder(createConfig());
    await recorder.advanceInquiry(createManager(query), 12);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[1][0]).toContain('SET search_version=search_version+1');
    expect(query.mock.calls[2][0]).toContain('i.is_secret=true');
    expect(query.mock.calls[2][0]).not.toContain('profile_id');
    expect(query.mock.calls[3][0]).toContain("j.status IN ('pending','running')");
  });

  it('invalidates under the source transaction and registers only its new public version', async () => {
    const query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([profile]).mockResolvedValueOnce([{ is_secret: false }]).mockResolvedValueOnce([{ id: '5' }]);
    const recorder = new SearchIndexRecorder(createConfig({ AI_SEARCH_INQUIRY_INDEX_ENABLED: 'true' }));
    await recorder.advanceInquiry(createManager(query), 12);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[0][0]).toContain('SET search_version=search_version+1');
    expect(query.mock.calls[2][0]).toContain('FOR UPDATE');
    expect(query.mock.calls[3][0]).toContain('is_secret=false');
  });
});
