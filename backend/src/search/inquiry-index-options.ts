import { SearchError } from './search-error';

const ACTIONS = ['backfill', 'reconcile', 'retry-failed', 'work', 'cleanup'] as const;
export interface InquiryIndexCommand {
  action: typeof ACTIONS[number];
  apply: boolean;
  limit: number;
  inquiryId?: number;
}

/** Validate before opening the DB: misspelled selectors must never widen a mutation. */
export function parseInquiryIndexCommand(args: readonly string[]): InquiryIndexCommand {
  const action = args[0] as InquiryIndexCommand['action'];
  if (!ACTIONS.includes(action)) throw new SearchError('INVALID_INPUT');
  const result: InquiryIndexCommand = { action, apply: false, limit: 100 };
  const flags = args.slice(args[1] === '--' ? 2 : 1);
  const seen = new Set<string>();
  for (let index = 0; index < flags.length; index++) {
    const token = flags[index];
    const separator = token.indexOf('=');
    const name = separator === -1 ? token : token.slice(0, separator);
    if (seen.has(name)) throw new SearchError('INVALID_INPUT');
    seen.add(name);
    if (name === '--apply' && separator === -1) { result.apply = true; continue; }
    const maximum = name === '--limit' && action === 'work' ? 10000 :
      name === '--inquiry-id' && action === 'retry-failed' ? 2147483647 : undefined;
    if (maximum === undefined) throw new SearchError('INVALID_INPUT');
    const value = separator === -1 ? flags[++index] : token.slice(separator + 1);
    if (!value || !/^[1-9]\d*$/.test(value)) throw new SearchError('INVALID_INPUT');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > maximum) throw new SearchError('INVALID_INPUT');
    if (name === '--limit') result.limit = number;
    else result.inquiryId = number;
  }
  return result;
}
