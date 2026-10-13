import 'reflect-metadata';
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { connectionOptions } from '../database/connection-options';
import { SearchIndexRecorder } from './search-index-recorder';
import { InquiryIndexStore } from './inquiry-index.store';
import { InquiryIndexMaintenance } from './inquiry-index.maintenance';
import { InquiryIndexProcessor } from './inquiry-index.processor';
import { GeminiEmbeddingClient } from '../intrastructure/ai/providers/gemini-embedding.client';
import { SearchError } from './search-error';
import { parseInquiryIndexCommand } from './inquiry-index-options';

async function main() {
  const { action, apply, limit, inquiryId } = parseInquiryIndexCommand(process.argv.slice(2));
  if (!apply) {
    console.log(JSON.stringify({ action, applied: false, instruction: 'Add --apply to record/process jobs. work calls the embedding API with masked inquiry text.' }));
    return;
  }
  const config = new ConfigService();
  const db = new DataSource({ ...connectionOptions, schema: process.env.SEARCH_INDEX_SCHEMA || 'public', synchronize: false, installExtensions: false });
  await db.initialize();
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  try {
    const store = new InquiryIndexStore(db, new SearchIndexRecorder(config));
    await store.recorder.assertProfile(db.manager);
    const maintenance = new InquiryIndexMaintenance(store);
    if (action === 'backfill') console.log(JSON.stringify(await maintenance.backfill()));
    if (action === 'reconcile') console.log(JSON.stringify(await maintenance.reconcile()));
    if (action === 'retry-failed') {
      console.log(JSON.stringify({ retried: await maintenance.retryFailed(inquiryId) }));
    }
    if (action === 'cleanup') console.log(JSON.stringify({ removed: await maintenance.cleanup() }));
    if (action === 'work') {
      const processor = new InquiryIndexProcessor(store, new GeminiEmbeddingClient(config));
      for (let index = 0; index < limit && !abort.signal.aborted; index++) {
        const result = await processor.runOne(abort.signal);
        console.log(JSON.stringify(result));
        if (result.status === 'idle') break;
      }
    }
  } finally { await db.destroy(); }
}
main().catch(error => { console.error(error instanceof SearchError ? error.code : 'INDEX_COMMAND_FAILED'); process.exitCode = 1; });
