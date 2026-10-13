import { SearchError } from './search-error';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';

/** pgvector stores float32: reject holes, overflow and vectors that become zero in storage. */
export function assertSearchVector(value: unknown): asserts value is number[] {
  if (!Array.isArray(value) || value.length !== PROFILE.dimensions) throw new SearchError('INVALID_EMBEDDING');
  let nonzero = false;
  for (let index = 0; index < value.length; index++) {
    const component: unknown = value[index];
    if (typeof component !== 'number' || !Number.isFinite(component)) throw new SearchError('INVALID_EMBEDDING');
    const stored = Math.fround(component);
    if (!Number.isFinite(stored)) throw new SearchError('INVALID_EMBEDDING');
    nonzero ||= stored !== 0;
  }
  if (!nonzero) throw new SearchError('INVALID_EMBEDDING');
}
