import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AssistantToolTrace } from '../../src/admin/assistant/assistant.service';
import type { InquiryEvalCase } from './inquiry-fixture';
import { inquiryToolObservations } from './inquiry-answer-observations';

const input = process.argv[2];
if (!input || process.argv.length !== 3) throw new Error('REPORT_REQUIRED');
const raw = readFileSync(input, 'utf8');
const original = JSON.parse(raw) as { planned: number; cases: { caseId: string; expected: InquiryEvalCase; errorCode: string | null; executedTools: AssistantToolTrace[]; observations: Record<string, unknown> | null }[] };
const recoveredCaseIds: string[] = [];
const cases = original.cases.map(item => {
  const observations = inquiryToolObservations(item.expected, item.executedTools);
  const recovered = item.errorCode === 'SEARCH_REQUEST_FAILED' && !observations.terminalSearchFailure && observations.invalidArgumentAttempts > 0;
  if (recovered) recoveredCaseIds.push(item.caseId);
  return { ...item, initialRunnerErrorCode: item.errorCode, errorCode: recovered ? null : item.errorCode,
    observations: { ...item.observations, ...observations } };
});
const output = join(__dirname, '../results', `search-inquiry-answer-audited-${basename(input)}`);
const result = { ...JSON.parse(raw), fixtureRole: 'improvement-diagnostic', audit: { sourceReport: basename(input), sourceReportSha256: createHash('sha256').update(raw).digest('hex'),
  explanation: 'Offline measurement correction only. A rejected date with trailing comma followed by an exact successful retrieval is a recovered tool-argument failure, not a terminal API error. Original tool traces, SDK failures, interrupted run and pending human verdicts remain preserved.',
  recoveredCaseIds, apiRequests: 0 }, cases, apiErrors: cases.filter(item => item.errorCode).length,
  recoveredToolArgumentFailures: recoveredCaseIds.length, humanReviewPending: original.planned, finalAnswerSuccessRate: null };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, recoveredCaseIds, apiErrors: result.apiErrors, apiRequests: 0, finalAnswerSuccessRate: null }));
