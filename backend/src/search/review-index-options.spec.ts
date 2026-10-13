import { parseReviewIndexCommand as parse } from './review-index-options';

describe('review index command boundary', () => {
  it.each(['backfill', 'reconcile', 'retry-failed', 'work', 'cleanup'])('defaults %s to a dry run', action => {
    expect(parse([action])).toEqual({ action, apply: false, limit: 100 });
  });

  it('keeps explicit selectors and supports equals or separate values', () => {
    expect(parse(['retry-failed', '--apply', '--review-id=2147483647'])).toMatchObject({ apply: true, reviewId: 2147483647 });
    expect(parse(['retry-failed', '--review-id', '1', '--apply'])).toMatchObject({ apply: true, reviewId: 1 });
    expect(parse(['work', '--', '--apply', '--limit', '10000'])).toMatchObject({ apply: true, limit: 10000 });
  });

  it.each([
    [], ['unknown'], ['retry-failed', '--apply', '--review-Id=1'], ['work', '--apply', '--limt=1'],
    ['work', '--apply=true'], ['work', '--apply', '--apply'], ['work', '--limit=1', '--limit=2'],
    ['backfill', '--review-id=1'], ['cleanup', '--limit=1'], ['work', '1'], ['work', '--limit'],
    ['work', '--limit', '--apply'], ['work', '--limit=0'], ['work', '--limit=-1'], ['work', '--limit=1.5'],
    ['work', '--limit=1e3'], ['work', '--limit=10001'], ['work', '--limit=NaN'],
    ['retry-failed', '--review-id=2147483648'], ['retry-failed', '--review-id='],
  ].map(args => ({ args })))('rejects invalid flags before any operation %#', ({ args }) => {
    expect(() => parse(args)).toThrow('INVALID_INPUT');
  });
});
