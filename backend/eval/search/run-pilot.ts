import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GeminiEmbeddingClient } from '../../src/intrastructure/ai/providers/gemini-embedding.client';
import { INITIAL_SEARCH_PROFILE } from '../../src/search/search-profile';
import { queryInput, reviewDocument } from '../../src/search/search-document';
import { SearchError } from '../../src/search/search-error';

/** Real SDK probe with synthetic inputs only. No user DB data, keys, raw response or vectors are written. */
async function main() {
  const client = new GeminiEmbeddingClient(new ConfigService<Record<string | symbol, unknown>>());
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const cases: { caseId: string; inputs: string[] }[] = [
    { caseId: 'korean-query', inputs: [queryInput('옷이 작아서 움직이기 불편해요')] },
    { caseId: 'independent-documents', inputs: [
      reviewDocument('팔 부분이 꽉 끼고 너무 작아요.').chunks[0].input,
      reviewDocument('작을까 걱정했는데 잘 맞아요.').chunks[0].input,
    ] },
    { caseId: 'long-korean-emoji', inputs: reviewDocument('한글😀 문장입니다. '.repeat(180)).chunks.map(chunk => chunk.input) },
  ];
  const results = [];
  for (const item of cases) {
    const started = performance.now();
    try {
      const result = await client.embed(item.inputs);
      const norms = result.vectors.map(vector => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)));
      const normalized = norms.every(norm => Math.abs(norm - 1) < 0.001);
      const distinctVectors = result.vectors.length < 2 || JSON.stringify(result.vectors[0]) !== JSON.stringify(result.vectors[1]);
      results.push({ caseId: item.caseId, status: 'pass', inputCount: item.inputs.length,
        vectorCount: result.vectors.length, dimensions: result.vectors.map(vector => vector.length),
        norms, normalized, distinctVectors,
        elapsedMs: performance.now() - started, usage: result.usage });
    } catch (error) {
      const safe = error instanceof SearchError ? error : new SearchError('EMBEDDING_UNAVAILABLE');
      results.push({ caseId: item.caseId, status: 'fail', errorCode: safe.code, retryable: safe.retryable, elapsedMs: performance.now() - started });
      // Don't repeatedly call a broken model, permission, quota or configuration.
      break;
    }
  }
  const passed = results.length === cases.length && results.every(item => item.status === 'pass' && item.distinctVectors && item.normalized);
  const result = { runId, profile: INITIAL_SEARCH_PROFILE, passed, planned: cases.length, executed: results.length,
    unexecuted: cases.length - results.length, syntheticInputsOnly: true, sdkVersion: '2.8.0',
    normalizationCriterion: 'finite nonzero 768 dimensions; L2 norm within 0.001 of 1',
    usage: client.snapshot(), cases: results };
  const directory = join(__dirname, '..', 'results');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `search-pilot-${runId}.json`);
  writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ path, passed, usage: result.usage, cases: results }));
  if (!passed) process.exitCode = 1;
}
main().catch(() => { console.error('PILOT_CONFIGURATION_FAILED'); process.exitCode = 1; });
