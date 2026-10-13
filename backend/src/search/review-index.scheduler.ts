import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, Interval } from '@nestjs/schedule';
import { ReviewIndexProcessor } from './review-index.processor';
import { ReviewIndexMaintenance } from './review-index.maintenance';
import { SearchError } from './search-error';
import { InquiryIndexProcessor } from './inquiry-index.processor';
import { InquiryIndexMaintenance } from './inquiry-index.maintenance';

@Injectable()
export class ReviewIndexScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(ReviewIndexScheduler.name);
  private readonly shutdown = new AbortController();
  private stopped = false;
  private maintaining = false;
  private working = false;
  private inquiryTurn = false;
  constructor(private readonly config: ConfigService, private readonly processor: ReviewIndexProcessor,
    private readonly maintenance: ReviewIndexMaintenance,
    @Optional() private readonly inquiryProcessor?: InquiryIndexProcessor,
    @Optional() private readonly inquiryMaintenance?: InquiryIndexMaintenance) {}

  private enabled(): boolean {
    return !this.stopped && !this.shutdown.signal.aborted && this.config.get('AI_SEARCH_WORKER_ENABLED') === 'true' &&
      (this.processor.store.recorder.reviewsEnabled() || !!this.inquiryProcessor?.store.recorder.inquiriesEnabled());
  }

  @Interval(1000)
  async tick(): Promise<void> {
    if (!this.enabled() || this.working) return;
    this.working = true;
    try {
      const reviews = this.processor.store.recorder.reviewsEnabled() ? this.processor : undefined;
      const inquiries = this.inquiryProcessor?.store.recorder.inquiriesEnabled() ? this.inquiryProcessor : undefined;
      const order = this.inquiryTurn ? [inquiries, reviews] : [reviews, inquiries];
      this.inquiryTurn = !this.inquiryTurn;
      for (const processor of order) {
        if (!processor || this.shutdown.signal.aborted) continue;
        const result = await processor.runOne(this.shutdown.signal);
        if (result.status === 'idle') continue;
        this.logger.log(JSON.stringify(result));
        if (result.status === 'failed' && ['PROFILE_MISMATCH', 'EMBEDDING_DISABLED', 'EMBEDDING_PERMISSION', 'EMBEDDING_MODEL', 'INVALID_EMBEDDING'].includes(result.errorCode ?? '')) this.stopped = true;
        break;
      }
    } catch (error) {
      this.stopped = true;
      this.logger.error(error instanceof SearchError ? error.code : 'INDEX_STORAGE_FAILED');
    } finally { this.working = false; }
  }

  @Cron('0 */5 * * * *')
  async reconcile(): Promise<void> {
    if (!this.enabled() || this.maintaining) return;
    this.maintaining = true;
    try {
      if (this.processor.store.recorder.reviewsEnabled()) this.logger.log(JSON.stringify({ source: 'review', ...await this.maintenance.reconcile() }));
      if (this.inquiryProcessor?.store.recorder.inquiriesEnabled() && this.inquiryMaintenance) this.logger.log(JSON.stringify({ source: 'inquiry', ...await this.inquiryMaintenance.reconcile() }));
    }
    catch { this.logger.error('INDEX_RECONCILE_FAILED'); }
    finally { this.maintaining = false; }
  }

  @Cron('0 0 3 * * *')
  async cleanup(): Promise<void> {
    if (this.enabled()) {
      try {
        if (this.processor.store.recorder.reviewsEnabled()) this.logger.log(JSON.stringify({ source: 'review', removedJobs: await this.maintenance.cleanup() }));
        if (this.inquiryProcessor?.store.recorder.inquiriesEnabled() && this.inquiryMaintenance) this.logger.log(JSON.stringify({ source: 'inquiry', removedJobs: await this.inquiryMaintenance.cleanup() }));
      }
      catch { this.logger.error('INDEX_CLEANUP_FAILED'); }
    }
  }

  onModuleDestroy(): void { this.shutdown.abort(); }
}
