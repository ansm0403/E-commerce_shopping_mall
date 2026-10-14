import { describe, expect, it } from '@jest/globals';
import { emptyHumanReview, summarizeHumanReview, ANSWER_REVIEW_CHECKS } from './answer-review';
import type { AnswerReviewReport, HumanAnswerReview, ReviewChecks } from './answer-review';
import { inquiryToolObservations } from './inquiry-answer-observations';
import type { AssistantToolTrace } from '../../src/admin/assistant/assistant.service';

const report: AnswerReviewReport = { planned: 30, executed: 30, unexecuted: 0, fullSuite: true,
  cases: Array.from({ length: 30 }, (_, index) => ({ caseId: `case-${index}`, question: '합성 질문', expected: { noEvidence: index >= 20 }, trace: {}, errorCode: null })) };
function reviewed(source = report): HumanAnswerReview {
  const result = emptyHumanReview(source, 'sha'); result.reviewer = '테스트 검토자'; result.reviewedAt = '2026-10-14T10:00:00+09:00';
  result.entries.forEach(entry => { entry.checks = Object.fromEntries(ANSWER_REVIEW_CHECKS.map(key => [key, true])) as ReviewChecks; entry.reason = '원문과 대조'; });
  return result;
}
describe('final answer human review reporting', () => {
  it('keeps all quality rates null while any human verdict is pending', () => {
    const result = summarizeHumanReview(report, emptyHumanReview(report, 'sha'), 'sha');
    expect(result.pending).toBe(30); expect(result.complete).toBe(false); expect(result.finalAnswerSuccessRate).toBeNull();
  });
  it('requires a reviewer and a dated record even when every boolean is true', () => {
    const data = reviewed(); data.reviewer = ''; data.reviewedAt = null;
    expect(summarizeHumanReview(report, data, 'sha').finalAnswerSuccessRate).toBeNull();
  });
  it('rejects source replacement and duplicate or invented case IDs', () => {
    expect(() => summarizeHumanReview(report, reviewed(), 'other')).toThrow('REVIEW_REPORT_MISMATCH');
    const duplicate = reviewed(); duplicate.entries[1].caseId = duplicate.entries[0].caseId;
    expect(() => summarizeHumanReview(report, duplicate, 'sha')).toThrow('DUPLICATE_CASE_ID');
    const invented = reviewed(); invented.entries[0].caseId = 'invented';
    expect(() => summarizeHumanReview(report, invented, 'sha')).toThrow('REVIEW_CASES_MISMATCH');
  });
  it('does not publish full-suite quality for a separately selected partial run', () => {
    const partial = { ...report, planned: 3, executed: 3, cases: report.cases.slice(0, 3), fullSuite: false };
    expect(summarizeHumanReview(partial, reviewed(partial), 'sha').finalAnswerSuccessRate).toBeNull();
  });
  it('does not let a terminal API failure count as a successful answer', () => {
    const failed = { ...report, cases: report.cases.map((item, index) => index ? item : { ...item, trace: null, errorCode: 'LLM_UNAVAILABLE' }) };
    expect(() => summarizeHumanReview(failed, reviewed(failed), 'sha')).toThrow('FAILED_EXECUTION_CANNOT_PASS');
    const valid = reviewed(failed); valid.entries[0].checks.stateExplanation = false;
    const result = summarizeHumanReview(failed, valid, 'sha');
    expect(result.evidence.successRate).toBe(19 / 20); expect(result.finalAnswerSuccessRate).toBe(29 / 30);
  });
  it('keeps unexecuted cases in the pending count', () => {
    const incomplete = { ...report, executed: 2, unexecuted: 28, cases: report.cases.slice(0, 2) };
    const result = summarizeHumanReview(incomplete, reviewed(incomplete), 'sha');
    expect(result.pending).toBe(28); expect(result.finalAnswerSuccessRate).toBeNull();
  });
});

describe('inquiry evaluation tool attempt classification', () => {
  const expected = { caseId: 'case', question: '합성 질문', query: '문제', productId: 601, startDate: '2026-10-01', endDate: '2026-10-12', relevantIds: [1], reason: '', answerFacts: [], noEvidence: false };
  const call = (status: string, args: Record<string, unknown>): AssistantToolTrace => ({ name: 'summarize_inquiries', args, result: { status, data: { sources: [] } } });
  const valid = { productId: 601, query: '문제', startDate: '2026-10-01', endDate: '2026-10-12' };
  it('records a rejected malformed date and its correction without calling it a terminal API failure', () => {
    const result = inquiryToolObservations(expected, [call('invalid_arguments', { ...valid, endDate: '2026-10-12,' }), call('ok', valid)]);
    expect(result.scopeMatched).toBe(true); expect(result.invalidArgumentAttempts).toBe(1); expect(result.terminalSearchFailure).toBe(false);
  });
  it('does not hide an actual retrieval with widened conditions behind a later correct retrieval', () => {
    expect(inquiryToolObservations(expected, [call('ok', { ...valid, endDate: undefined }), call('ok', valid)]).scopeMatched).toBe(false);
  });
  it('retains an unrecovered terminal tool failure', () => {
    expect(inquiryToolObservations(expected, [call('unavailable', valid)]).terminalSearchFailure).toBe(true);
  });
});
