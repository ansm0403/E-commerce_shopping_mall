import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchIndexRecorder } from './search-index-recorder';

@Module({ imports: [ConfigModule], providers: [SearchIndexRecorder], exports: [SearchIndexRecorder] })
export class SearchIndexJobsModule {}
