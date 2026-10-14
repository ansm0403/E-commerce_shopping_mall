import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GeminiClient } from '../../src/intrastructure/ai/providers/gemini.client';
import type { LlmClient, LlmUsage } from '../../src/intrastructure/ai/llm-client.interface';
import type { ConfigService } from '@nestjs/config';

export class PacedEvalLlmClient extends GeminiClient {
  private nextRequestAt = 0;
  constructor(config: ConfigService) { super(config); }
  override generateWithTools(params: Parameters<LlmClient['generateWithTools']>[0]) {
    return super.generateWithTools({ ...params, beforeRequest: async () => {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, this.nextRequestAt - Date.now())));
      this.nextRequestAt = Date.now() + 6000;
    } });
  }
}

export function codeVersion() {
  const files = ['src/search/semantic-search.service.ts', 'src/search/search-document.ts', 'src/search/search-input.ts',
    'src/search/search-profile.ts', 'src/admin/assistant/assistant.service.ts', 'src/admin/assistant/assistant-tools.ts',
    'src/admin/assistant/assistant-tool-schemas.ts', 'src/intrastructure/ai/providers/gemini.client.ts', 'src/intrastructure/ai/llm-failure.ts',
    'src/intrastructure/ai/llm-request-deadline.ts', 'src/search/inquiry-index.store.ts', 'src/search/inquiry-index.processor.ts',
    'src/search/search-index-recorder.ts', 'src/search/search-contract.ts', 'eval/search/inquiry-fixture.ts', 'eval/search/run-inquiry-search-eval.ts',
    'eval/search/inquiry-pilot-confirmation-fixture.ts', 'eval/search/run-inquiry-assistant-pilot.ts',
    'eval/search/inquiry-final-fixture.ts', 'eval/search/run-inquiry-answer-eval.ts', 'eval/search/synthetic-inquiry-assistant.ts',
    'eval/search/inquiry-final-fixture-v2.ts', 'eval/search/inquiry-final-fixture-v3.ts', 'eval/search/inquiry-answer-observations.ts',
    'eval/search/fixture.ts', 'eval/search/final-fixture.ts', 'eval/search/final-fixture-v2.ts'];
  const hash = createHash('sha256');
  for (const file of files) { hash.update(file); hash.update(readFileSync(resolve(__dirname, '../..', file))); }
  return { sha256: hash.digest('hex'), files, description: 'SHA256 of evaluated working-tree sources, including uncommitted changes.' };
}
export function sumUsage(values: (LlmUsage | null | undefined)[]) {
  return values.reduce<LlmUsage>((total, value) => ({ inputTokens: total.inputTokens + (value?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (value?.outputTokens ?? 0), cachedTokens: total.cachedTokens + (value?.cachedTokens ?? 0) }),
  { inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
}
