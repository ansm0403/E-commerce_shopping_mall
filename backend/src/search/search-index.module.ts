import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { GeminiEmbeddingClient } from '../intrastructure/ai/providers/gemini-embedding.client';
import { SearchIndexJobsModule } from './search-index-jobs.module';
import { SearchIndexRecorder } from './search-index-recorder';
import { ReviewIndexStore } from './review-index.store';
import { ReviewIndexProcessor } from './review-index.processor';
import { ReviewIndexMaintenance } from './review-index.maintenance';
import { ReviewIndexScheduler } from './review-index.scheduler';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';
import { SearchError } from './search-error';
import type { EmbeddingClient } from '../intrastructure/ai/embedding-client.interface';
import { InquiryIndexStore } from './inquiry-index.store';
import { InquiryIndexProcessor } from './inquiry-index.processor';
import { InquiryIndexMaintenance } from './inquiry-index.maintenance';

const INDEX_EMBEDDING = Symbol('INDEX_EMBEDDING');

/** Uses existing ScheduleModule.forRoot(); no dependency on source services or admin. */
@Module({
  imports: [ConfigModule, SearchIndexJobsModule],
  providers: [
    { provide: ReviewIndexStore, useFactory: (db: DataSource, recorder: SearchIndexRecorder) => new ReviewIndexStore(db, recorder), inject: [DataSource, SearchIndexRecorder] },
    { provide: InquiryIndexStore, useFactory: (db: DataSource, recorder: SearchIndexRecorder) => new InquiryIndexStore(db, recorder), inject: [DataSource, SearchIndexRecorder] },
    { provide: INDEX_EMBEDDING, useFactory: (recorder: SearchIndexRecorder, config: ConfigService): EmbeddingClient => {
      const enabled = (recorder.reviewsEnabled() || recorder.inquiriesEnabled()) && config.get('AI_SEARCH_WORKER_ENABLED') === 'true';
      return enabled ? new GeminiEmbeddingClient(config) : {
        model: PROFILE.model, dimensions: PROFILE.dimensions, isEnabled: () => false,
        embed: async () => { throw new SearchError('EMBEDDING_DISABLED'); },
      };
    }, inject: [SearchIndexRecorder, ConfigService] },
    { provide: ReviewIndexProcessor, useFactory: (store: ReviewIndexStore, embedding: EmbeddingClient) => new ReviewIndexProcessor(store, embedding), inject: [ReviewIndexStore, INDEX_EMBEDDING] },
    { provide: InquiryIndexProcessor, useFactory: (store: InquiryIndexStore, embedding: EmbeddingClient) => new InquiryIndexProcessor(store, embedding), inject: [InquiryIndexStore, INDEX_EMBEDDING] },
    { provide: ReviewIndexMaintenance, useFactory: (store: ReviewIndexStore) => new ReviewIndexMaintenance(store), inject: [ReviewIndexStore] },
    { provide: InquiryIndexMaintenance, useFactory: (store: InquiryIndexStore) => new InquiryIndexMaintenance(store), inject: [InquiryIndexStore] },
    ReviewIndexScheduler,
  ],
})
export class SearchIndexModule {}
