export const ANSWER_REVIEW_CHECKS = ['conditions', 'evidence', 'polarity', 'noUnsupportedClaims', 'stateExplanation'] as const;
export type ReviewChecks = Record<typeof ANSWER_REVIEW_CHECKS[number], boolean | null>;
export interface AnswerReviewReport {
  planned: number; executed: number; unexecuted: number; fullSuite?: boolean;
  cases: { caseId: string; question: string; expected: { noEvidence?: boolean }; trace: unknown; errorCode: string | null }[];
}
export interface HumanAnswerReview {
  schemaVersion: 1; sourceReportSha256: string; reviewer: string; reviewedAt: string | null;
  entries: { caseId: string; checks: ReviewChecks; reason: string }[];
}

/** Fail closed: unchecked, partial, mismatched or model/agent-only verdicts cannot become final quality metrics. */
export function summarizeHumanReview(report: AnswerReviewReport, review: HumanAnswerReview, sourceSha256: string) {
  if (review.schemaVersion !== 1 || review.sourceReportSha256 !== sourceSha256) throw new Error('REVIEW_REPORT_MISMATCH');
  const ids = report.cases.map(item => item.caseId);
  if (new Set(ids).size !== ids.length || new Set(review.entries.map(item => item.caseId)).size !== review.entries.length) throw new Error('DUPLICATE_CASE_ID');
  if (review.entries.length !== ids.length || review.entries.some(item => !ids.includes(item.caseId))) throw new Error('REVIEW_CASES_MISMATCH');
  const rows = report.cases.map(item => {
    const entry = review.entries.find(row => row.caseId === item.caseId)!;
    const values = ANSWER_REVIEW_CHECKS.map(key => entry.checks[key]);
    if (values.some(value => value !== null && typeof value !== 'boolean')) throw new Error('INVALID_REVIEW_CHECK');
    const pending = values.some(value => value === null) || !entry.reason.trim();
    const passed = !pending && values.every(value => value === true) && !item.errorCode && !!item.trace;
    if (!pending && values.every(value => value === true) && (item.errorCode || !item.trace)) throw new Error('FAILED_EXECUTION_CANNOT_PASS');
    return { caseId: item.caseId, noEvidence: !!item.expected.noEvidence, verdict: pending ? 'pending' : passed ? 'pass' : 'fail', reason: entry.reason };
  });
  const pending = report.planned - rows.filter(row => row.verdict !== 'pending').length;
  const identity = !!review.reviewer.trim() && !!review.reviewedAt && /(?:Z|[+-]\d{2}:\d{2})$/.test(review.reviewedAt) && Number.isFinite(Date.parse(review.reviewedAt));
  const fullExecution = report.fullSuite !== false && report.planned === 30 && report.executed === report.planned && report.unexecuted === 0 && report.cases.length === report.planned;
  const complete = fullExecution && pending === 0 && identity;
  const group = (noEvidence: boolean) => {
    const selected = rows.filter(row => row.noEvidence === noEvidence);
    const passed = selected.filter(row => row.verdict === 'pass').length;
    return { passed, planned: selected.length, successRate: complete && selected.length ? passed / selected.length : null };
  };
  return { complete, planned: report.planned, executed: report.executed, reviewed: rows.filter(row => row.verdict !== 'pending').length,
    pending, reviewerRecorded: identity, fullExecution, evidence: group(false), noEvidence: group(true),
    finalAnswerSuccessRate: complete ? rows.filter(row => row.verdict === 'pass').length / report.planned : null, rows };
}

export function emptyHumanReview(report: AnswerReviewReport, sha256: string): HumanAnswerReview {
  return { schemaVersion: 1, sourceReportSha256: sha256, reviewer: '', reviewedAt: null,
    entries: report.cases.map(item => ({ caseId: item.caseId, checks: Object.fromEntries(ANSWER_REVIEW_CHECKS.map(key => [key, null])) as ReviewChecks, reason: '' })) };
}
