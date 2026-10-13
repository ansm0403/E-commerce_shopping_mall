import { createHash } from 'node:crypto';
import { scrubText } from '../common/utils/scrub-text';
import { SearchError } from './search-error';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';

export interface SearchDocument {
  title: string;
  text: string;
  contentHash: string;
  chunks: { index: number; text: string; input: string }[];
}

export function normalizeSearchText(value: string | null | undefined): string {
  return (scrubText(value) ?? '').replace(/\r\n?/g, '\n').trim();
}

export function queryInput(query: string): string {
  const text = normalizeSearchText(query);
  if (!text || Array.from(text).length > PROFILE.maxCodePoints) {
    throw new SearchError('INVALID_INPUT');
  }
  const input = `task: search result | query: ${text}`;
  if (Buffer.byteLength(input, 'utf8') > PROFILE.maxInputBytes) {
    throw new SearchError('INVALID_INPUT');
  }
  return input;
}

export function reviewDocument(comment: string | null): SearchDocument {
  return document('', normalizeSearchText(comment));
}

export function inquiryDocument(source: {
  title: string; content: string; answer: string | null; isSecret: boolean;
}): SearchDocument | null {
  if (source.isSecret) return null;
  const content = normalizeSearchText(source.content);
  const answer = normalizeSearchText(source.answer);
  return document(normalizeSearchText(source.title), [
    content ? `[문의 본문]\n${content}` : '',
    answer ? `[답변]\n${answer}` : '',
  ].filter(Boolean).join('\n\n'));
}

function document(title: string, text: string): SearchDocument {
  const contentHash = createHash('sha256').update(JSON.stringify([title, text])).digest('hex');
  const prefix = `title: ${title || 'none'} | text: `;
  const chunks: SearchDocument['chunks'] = [];
  if (!title && !text) return { title, text, contentHash, chunks };
  if (Buffer.byteLength(prefix, 'utf8') > PROFILE.maxInputBytes) {
    throw new SearchError('SOURCE_TOO_LARGE');
  }
  const points = Array.from(text);
  let start = 0;
  do {
    let end = Math.min(start + PROFILE.maxCodePoints, points.length);
    while (Buffer.byteLength(prefix + points.slice(start, end).join(''), 'utf8') > PROFILE.maxInputBytes) end--;
    if (end === start && points.length) throw new SearchError('SOURCE_TOO_LARGE');
    if (end < points.length) {
      // Prefer a paragraph boundary only when overlap still permits progress.
      for (let boundary = end - 1; boundary > start + PROFILE.overlapCodePoints; boundary--) {
        if (points[boundary - 1] === '\n' && points[boundary] === '\n') {
          end = boundary + 1;
          break;
        }
      }
    }
    const chunk = points.slice(start, end).join('');
    chunks.push({ index: chunks.length, text: chunk, input: prefix + chunk });
    if (chunks.length > PROFILE.maxChunks) throw new SearchError('SOURCE_TOO_LARGE');
    if (end === points.length) break;
    start = Math.max(start + 1, end - PROFILE.overlapCodePoints);
  } while (start < points.length);
  return { title, text, contentHash, chunks };
}
