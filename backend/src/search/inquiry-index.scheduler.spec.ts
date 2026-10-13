import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ReviewIndexScheduler } from './review-index.scheduler';
import { ReviewIndexProcessor } from './review-index.processor';
import { ReviewIndexMaintenance } from './review-index.maintenance';
import { InquiryIndexProcessor } from './inquiry-index.processor';
import { InquiryIndexMaintenance } from './inquiry-index.maintenance';
import { SearchIndexModule } from './search-index.module';

@Module({})
class ProbeDatabaseModule {}

function setup(reviewEnabled = true, inquiryEnabled = true, workerEnabled = true) {
  const reviewRun = jest.fn().mockResolvedValue({ status: 'done', reviewId: 1 });
  const inquiryRun = jest.fn().mockResolvedValue({ status: 'done', inquiryId: 1 });
  const reviewReconcile = jest.fn().mockResolvedValue({ scanned: 0 });
  const inquiryReconcile = jest.fn().mockResolvedValue({ scanned: 0 });
  const reviewCleanup = jest.fn().mockResolvedValue(0);
  const inquiryCleanup = jest.fn().mockResolvedValue(0);
  const reviews = { runOne: reviewRun, store: { recorder: { reviewsEnabled: () => reviewEnabled } } } as unknown as ReviewIndexProcessor;
  const inquiries = { runOne: inquiryRun, store: { recorder: { inquiriesEnabled: () => inquiryEnabled } } } as unknown as InquiryIndexProcessor;
  const scheduler = new ReviewIndexScheduler(new ConfigService({ AI_SEARCH_WORKER_ENABLED: String(workerEnabled) }), reviews,
    { reconcile: reviewReconcile, cleanup: reviewCleanup } as unknown as ReviewIndexMaintenance, inquiries,
    { reconcile: inquiryReconcile, cleanup: inquiryCleanup } as unknown as InquiryIndexMaintenance);
  return { scheduler, reviewRun, inquiryRun, reviewReconcile, inquiryReconcile, reviewCleanup, inquiryCleanup };
}

describe('shared inquiry/review worker scheduling', () => {
  it('alternates source types and runs only one job per tick', async () => {
    const { scheduler, reviewRun, inquiryRun } = setup();
    await scheduler.tick(); expect(reviewRun).toHaveBeenCalledTimes(1); expect(inquiryRun).not.toHaveBeenCalled();
    await scheduler.tick(); expect(inquiryRun).toHaveBeenCalledTimes(1);
    await scheduler.tick(); expect(reviewRun).toHaveBeenCalledTimes(2);
    scheduler.onModuleDestroy();
  });

  it('falls through an empty source queue without starving the other source', async () => {
    const { scheduler, reviewRun, inquiryRun } = setup();
    reviewRun.mockResolvedValue({ status: 'idle' });
    await scheduler.tick(); expect(reviewRun).toHaveBeenCalledTimes(1); expect(inquiryRun).toHaveBeenCalledTimes(1);
    scheduler.onModuleDestroy();
  });

  it('serializes ticks while an embedding request is still running', async () => {
    const { scheduler, reviewRun, inquiryRun } = setup();
    let finish = () => undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    reviewRun.mockImplementationOnce(async () => { await wait; return { status: 'done', reviewId: 1 }; });
    const first = scheduler.tick();
    await scheduler.tick(); expect(reviewRun).toHaveBeenCalledTimes(1); expect(inquiryRun).not.toHaveBeenCalled();
    finish(); await first; await scheduler.tick(); expect(inquiryRun).toHaveBeenCalledTimes(1);
    scheduler.onModuleDestroy();
  });

  it.each([[false, true], [true, false], [false, false]])('respects source flags review=%s inquiry=%s', async (reviewEnabled, inquiryEnabled) => {
    const { scheduler, reviewRun, inquiryRun, reviewReconcile, inquiryReconcile, reviewCleanup, inquiryCleanup } = setup(reviewEnabled, inquiryEnabled);
    await scheduler.tick(); await scheduler.reconcile(); await scheduler.cleanup();
    expect(reviewRun).toHaveBeenCalledTimes(Number(reviewEnabled)); expect(inquiryRun).toHaveBeenCalledTimes(Number(inquiryEnabled));
    expect(reviewReconcile).toHaveBeenCalledTimes(Number(reviewEnabled)); expect(inquiryReconcile).toHaveBeenCalledTimes(Number(inquiryEnabled));
    expect(reviewCleanup).toHaveBeenCalledTimes(Number(reviewEnabled)); expect(inquiryCleanup).toHaveBeenCalledTimes(Number(inquiryEnabled));
    scheduler.onModuleDestroy();
  });

  it('does no work or maintenance when the worker flag is off', async () => {
    const state = setup(true, true, false);
    await state.scheduler.tick(); await state.scheduler.reconcile(); await state.scheduler.cleanup();
    expect(state.reviewRun).not.toHaveBeenCalled(); expect(state.inquiryRun).not.toHaveBeenCalled();
    expect(state.reviewReconcile).not.toHaveBeenCalled(); expect(state.inquiryReconcile).not.toHaveBeenCalled();
    expect(state.reviewCleanup).not.toHaveBeenCalled(); expect(state.inquiryCleanup).not.toHaveBeenCalled();
  });

  it('halts both queues after a shared model or permission failure', async () => {
    const { scheduler, reviewRun, inquiryRun } = setup();
    reviewRun.mockResolvedValueOnce({ status: 'failed', errorCode: 'EMBEDDING_PERMISSION' });
    await scheduler.tick(); await scheduler.tick();
    expect(reviewRun).toHaveBeenCalledTimes(1); expect(inquiryRun).not.toHaveBeenCalled();
    scheduler.onModuleDestroy();
  });

  it('forwards shutdown cancellation and never resumes either queue', async () => {
    const { scheduler, reviewRun, inquiryRun } = setup();
    await scheduler.tick(); const signal = reviewRun.mock.calls[0][0] as AbortSignal;
    expect(signal.aborted).toBe(false); scheduler.onModuleDestroy(); expect(signal.aborted).toBe(true);
    await scheduler.tick(); await scheduler.reconcile(); await scheduler.cleanup();
    expect(reviewRun).toHaveBeenCalledTimes(1); expect(inquiryRun).not.toHaveBeenCalled();
  });

  it.each([
    { AI_SEARCH_REVIEW_INDEX_ENABLED: 'false', AI_SEARCH_INQUIRY_INDEX_ENABLED: 'false', AI_SEARCH_WORKER_ENABLED: 'false' },
    { AI_SEARCH_REVIEW_INDEX_ENABLED: 'false', AI_SEARCH_INQUIRY_INDEX_ENABLED: 'true', AI_SEARCH_WORKER_ENABLED: 'false' },
    { AI_SEARCH_REVIEW_INDEX_ENABLED: 'true', AI_SEARCH_INQUIRY_INDEX_ENABLED: 'true', AI_SEARCH_WORKER_ENABLED: 'true' },
  ])('injects one embedding client shared by both source processors %#', async settings => {
    const query = jest.fn();
    const application = await Test.createTestingModule({ imports: [
      { module: ProbeDatabaseModule, global: true, providers: [{ provide: DataSource, useValue: { manager: { query } } }], exports: [DataSource] },
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ ...settings, GEMINI_API_KEY: '', AI_SEARCH_EMBEDDING_RPM: 10 })] }),
      SearchIndexModule,
    ] }).compile();
    try {
      expect(application.get(ReviewIndexProcessor).embedding).toBe(application.get(InquiryIndexProcessor).embedding);
      expect(query).not.toHaveBeenCalled();
    } finally { await application.close(); }
  });
});
