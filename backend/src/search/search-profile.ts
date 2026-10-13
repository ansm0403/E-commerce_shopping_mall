/** Immutable search format. Changes require a new profile and reindexing. */
export const INITIAL_SEARCH_PROFILE = Object.freeze({
  id: 'gemini-embedding-2-768-review-inquiry-v1',
  model: 'gemini-embedding-2',
  dimensions: 768,
  preprocessingVersion: 'v1',
  maskingVersion: 'scrub-text-v1',
  chunkingVersion: 'unicode-paragraph-v1',
  queryTemplate: 'task: search result | query: {text}',
  documentTemplate: 'title: {title} | text: {text}',
  maxCodePoints: 1000,
  overlapCodePoints: 100,
  maxInputBytes: 4096,
  maxChunks: 32,
});

export type SearchProfile = typeof INITIAL_SEARCH_PROFILE;

/** Activation is operational state, never part of the immutable profile. */
export function searchFlags(get: (key: string) => unknown) {
  return {
    reviews: get('AI_SEARCH_REVIEWS_ENABLED') === 'true',
    inquiries: get('AI_SEARCH_INQUIRIES_ENABLED') === 'true',
    worker: get('AI_SEARCH_WORKER_ENABLED') === 'true',
    structured: get('AI_SEARCH_STRUCTURED_ENABLED') === 'true',
  };
}
