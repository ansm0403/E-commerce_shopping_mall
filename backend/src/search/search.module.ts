import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { GeminiEmbeddingClient } from '../intrastructure/ai/providers/gemini-embedding.client';
import { SearchIndexJobsModule } from './search-index-jobs.module';
import { SearchIndexRecorder } from './search-index-recorder';
import { SemanticSearchService } from './semantic-search.service';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';
import { SearchError } from './search-error';

@Module({ imports: [ConfigModule, SearchIndexJobsModule], providers: [{
  provide: SemanticSearchService,
  useFactory: (db: DataSource, config: ConfigService, recorder: SearchIndexRecorder) => new SemanticSearchService(db, config,
    config.get('AI_SEARCH_REVIEWS_ENABLED') === 'true' || config.get('AI_SEARCH_INQUIRIES_ENABLED') === 'true' ? new GeminiEmbeddingClient(config) : {
      model: PROFILE.model, dimensions: PROFILE.dimensions, isEnabled: () => false, embed: async () => { throw new SearchError('EMBEDDING_DISABLED'); },
    }, recorder), inject: [DataSource, ConfigService, SearchIndexRecorder],
}], exports: [SemanticSearchService] })
export class SearchModule {}
