import type { EmbeddingClient } from '../intrastructure/ai/embedding-client.interface';
import { reviewDocument } from './search-document';
import { SearchError } from './search-error';
import { ReviewIndexStore } from './review-index.store';
import { assertSearchVector } from './search-vector';

export interface IndexOutcome { status: 'idle' | 'done' | 'reused' | 'discarded' | 'failed'; jobId?: string; reviewId?: number; version?: string; errorCode?: string; }

/** At most one job per instance, even when manual execution and scheduler overlap. */
export class ReviewIndexProcessor {
  private busy = false;
  private halted = false;
  constructor(readonly store: ReviewIndexStore, readonly embedding: EmbeddingClient, readonly heartbeatMs = 30000) {}

  async runOne(signal?: AbortSignal): Promise<IndexOutcome> {
    if (this.busy || this.halted || signal?.aborted) return { status: 'idle' };
    this.busy = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let heartbeat: Promise<void> | undefined;
    try {
      await this.store.recorder.assertProfile(this.store.db.manager);
      if (!this.embedding.isEnabled()) throw new SearchError('EMBEDDING_DISABLED');
      const job = await this.store.claim();
      if (!job) return { status: 'idle' };
      const meta = { jobId: job.id, reviewId: job.review_id, version: job.source_version };
      const abort = new AbortController();
      const requestSignal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
      let leaseLost = false;
      let renewing = false;
      timer = setInterval(() => {
        if (renewing || leaseLost) return;
        renewing = true;
        heartbeat = this.store.heartbeat(job).then(valid => {
          if (!valid) { leaseLost = true; abort.abort(); }
        }).catch(() => { leaseLost = true; abort.abort(); }).finally(() => { renewing = false; });
      }, this.heartbeatMs);
      try {
        const source = await this.store.source(job);
        const document = reviewDocument(source.comment);
        if (await this.store.complete(job, document)) return { ...meta, status: document.chunks.length ? 'reused' : 'done' };
        const vectors = [];
        for (const chunk of document.chunks) {
          await this.store.source(job);
          const result = await this.embedding.embed([chunk.input], requestSignal, async () => { await this.store.source(job); });
          if (!Array.isArray(result?.vectors) || result.vectors.length !== 1) throw new SearchError('INVALID_EMBEDDING');
          assertSearchVector(result.vectors[0]);
          vectors.push(result.vectors[0]);
        }
        if (leaseLost || requestSignal.aborted) throw new SearchError('LEASE_LOST');
        const committed = await this.store.complete(job, document, vectors);
        return { ...meta, status: committed ? 'done' : 'discarded' };
      } catch (error) {
        const safe = error instanceof SearchError ? error : new SearchError('INDEX_STORAGE_FAILED', true);
        if (leaseLost || ['SOURCE_CHANGED', 'SOURCE_DELETED', 'LEASE_LOST'].includes(safe.code)) {
          await this.store.discard(job);
          return { ...meta, status: 'discarded' };
        }
        if (['PROFILE_MISMATCH', 'EMBEDDING_DISABLED', 'EMBEDDING_PERMISSION', 'EMBEDDING_MODEL', 'INVALID_EMBEDDING'].includes(safe.code)) this.halted = true;
        await this.store.fail(job, safe.code === 'ABORTED' ? new SearchError('ABORTED', true) : safe);
        return { ...meta, status: 'failed', errorCode: safe.code };
      }
    } finally {
      if (timer) clearInterval(timer);
      await heartbeat;
      this.busy = false;
    }
  }
}
