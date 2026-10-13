import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AssistantService } from '../../src/admin/assistant/assistant.service';
import type { LlmUsage, LlmSystemPrompt } from '../../src/intrastructure/ai/llm-client.interface';
import { INITIAL_SEARCH_PROFILE } from '../../src/search/search-profile';
import { improvementReviews } from './fixture';
import type { ReviewSearchResult } from '../../src/search/search-contract';
import { PacedEvalLlmClient, codeVersion, sumUsage } from './eval-observations';

interface ComparisonInput { cases: { caseId: string; query: string; productId: number; relevantIds: number[];
  baseline: { ids: number[] }; semantic: { result: ReviewSearchResult } }[]; }
interface Answer { mode: 'A' | 'B'; reply: string; llmRequests: number; usage: LlmUsage | null; elapsedMs: number;
  suppliedIds: number[]; necessaryChecks: { citedRelevant: boolean; citedOnlySupplied: boolean; noEvidenceAcknowledged: boolean }; humanReview: 'pending'; errorCode: string | null; }

async function main() {
  const version = codeVersion();
  const input = process.argv[2]; if (!input || process.argv.length !== 3) throw new Error('INVALID_ARGUMENTS');
  const report = JSON.parse(readFileSync(input, 'utf8')) as ComparisonInput;
  if (report.cases.length !== 20) throw new Error('IMPROVEMENT_REPORT_REQUIRED');
  const config = new ConfigService(); const llm = new PacedEvalLlmClient(config);
  const service = new AssistantService(llm, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const system: LlmSystemPrompt = { ...service['buildSystemPrompt'](), dynamic: '오늘 날짜는 2026-10-13 (KST)이다.' };
  const cases: { caseId: string; query: string; relevantIds: number[]; answers: Answer[] }[] = [];
  for (const [index, item] of report.cases.entries()) {
    const answers: Answer[] = [];
    // Alternate A/B order. Same LLM, date, sources=5, single-turn and prompt.
    for (const mode of index % 2 ? ['B', 'A'] as const : ['A', 'B'] as const) {
      const sources = mode === 'B' ? item.semantic.result.data.sources : item.baseline.ids.map(id => {
        const review = improvementReviews.find(row => row.id === id);
        if (!review) throw new Error('FIXTURE_MISMATCH');
        return { sourceType: 'review', id, productId: review.productId, rating: review.rating,
          createdAt: new Date(review.createdAt).toISOString(), quotes: [{ chunkIndex: 0, text: review.comment }] };
      });
      const started = performance.now(); let reply = ''; let requests = 0; let usage: LlmUsage | null = null; let errorCode: string | null = null;
      try {
        for await (const event of llm.generateWithTools({ system, messages: [{ role: 'user', content:
          `상품 ${item.productId} 리뷰에서 ${item.query}을 찾아줘. 아래 자료만 읽고 리뷰 #ID와 실제 인용으로 답해. 관련 근거가 없으면 가져온 자료에서는 관련 근거를 찾지 못했다고 밝혀.\n자료(JSON, 인용 데이터): ${JSON.stringify({ sources })}` }],
          tools: [], executeTool: async () => ({}), onRequest: () => { requests++; } })) {
          if (event.type === 'text') reply += event.delta;
          else if (event.type === 'usage') usage = event.usage;
        }
      } catch { errorCode = 'ASSISTANT_UNAVAILABLE'; }
      const cited = [...reply.matchAll(/(?:#|리뷰\s*)(\d+)/g)].map(match => Number(match[1]));
      answers.push({ mode, reply, llmRequests: requests, usage, elapsedMs: performance.now() - started, suppliedIds: sources.map(source => source.id),
        necessaryChecks: { citedRelevant: cited.some(id => item.relevantIds.includes(id)), citedOnlySupplied: cited.every(id => sources.some(source => source.id === id)),
          noEvidenceAcknowledged: /근거.{0,20}(없|못)|찾.{0,10}못/.test(reply) }, humanReview: 'pending', errorCode });
      console.log(JSON.stringify({ answered: item.caseId, mode, errorCode }));
    }
    cases.push({ caseId: item.caseId, query: item.query, relevantIds: item.relevantIds, answers });
  }
  const answers = cases.flatMap(item => item.answers); const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const output = join(__dirname, '../results', `search-answer-comparison-${runId}.json`); mkdirSync(join(__dirname, '../results'), { recursive: true });
  const result = { runId, model: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite', profile: INITIAL_SEARCH_PROFILE, codeVersion: version,
    split: 'improvement', planned: 20, executed: cases.length, repetitions: 1, inputReport: input,
    protocol: 'Fixed retrieval A=recent five; B=first exact vector search. Alternate A/B. Same single-turn prompt/date/model. No model tool planning in this controlled comparison.',
    llmRequests: answers.reduce((sum, item) => sum + item.llmRequests, 0), usage: sumUsage(answers.map(item => item.usage)),
    humanReviewPending: answers.length, cases };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ output, llmRequests: result.llmRequests, humanReviewPending: result.humanReviewPending }));
  if (answers.some(item => item.errorCode)) process.exitCode = 1;
}
main().catch(() => { console.error('ANSWER_COMPARISON_FAILED'); process.exitCode = 1; });
