export type SearchErrorCode =
  | 'SOURCE_TOO_LARGE'
  | 'INVALID_INPUT'
  | 'INVALID_EMBEDDING'
  | 'PROFILE_MISMATCH'
  | 'EMBEDDING_DISABLED'
  | 'EMBEDDING_PERMISSION'
  | 'EMBEDDING_MODEL'
  | 'EMBEDDING_RATE_LIMIT'
  | 'EMBEDDING_TIMEOUT'
  | 'EMBEDDING_UNAVAILABLE'
  | 'SOURCE_CHANGED'
  | 'SOURCE_DELETED'
  | 'LEASE_LOST'
  | 'INDEX_STORAGE_FAILED'
  | 'ABORTED';

/** Never retain provider messages, response bodies, inputs or API keys. */
export class SearchError extends Error {
  constructor(
    readonly code: SearchErrorCode,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'SearchError';
  }
}
