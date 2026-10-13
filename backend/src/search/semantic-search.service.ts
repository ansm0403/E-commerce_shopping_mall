import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import type { EmbeddingClient, EmbeddingUsage } from '../intrastructure/ai/embedding-client.interface';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';
import { queryInput, normalizeSearchText, reviewDocument, inquiryDocument } from './search-document';
import { SearchIndexRecorder } from './search-index-recorder';
import { searchTable } from './search-sql';
import { assertSearchVector } from './search-vector';
import { SearchError } from './search-error';
import { isAdminToolContext, ToolExecutionContext } from './tool-execution-context';
import { reviewSearchInput, ReviewSearchInput, inquirySearchInput, InquirySearchInput, kstDayStart, kstDayEndExclusive } from './search-input';
import { ReviewSearchResult, ReviewSearchScope, ReviewSearchSource, InquirySearchResult, InquirySearchScope, InquirySearchSource, SearchCoverage, searchFailure, inquirySearchFailure } from './search-contract';

interface Candidate { review_id: number; source_version: string; chunk_index: number; distance: number; }
interface CurrentChunk extends Candidate { product_id: number; rating: number; created_at: Date; comment: string; text: string; content_hash: string; job_hash: string; }
export interface SearchDiagnostics {
  embeddingUsage: EmbeddingUsage | null;
  embeddingMs: number; databaseMs: number; totalMs: number;
  candidates: Candidate[];
  invalidatedSourceCount: number;
}
const baseScope = (): ReviewSearchScope => ({ sourceType: 'review', timezone: 'Asia/Seoul', unit: 'source', profileId: PROFILE.id });
interface InquiryCandidate { inquiry_id: number; source_version: string; chunk_index: number; distance: number; }
interface InquiryCurrentChunk extends InquiryCandidate {
  product_id: number; status: 'waiting' | 'answered'; created_at: Date;
  title: string; content: string; answer: string | null; is_secret: boolean;
  text: string; content_hash: string; job_hash: string;
}
export interface InquirySearchDiagnostics extends Omit<SearchDiagnostics, 'candidates'> { candidates: InquiryCandidate[]; }
const inquiryBaseScope = (): InquirySearchScope => ({ sourceType: 'inquiry', timezone: 'Asia/Seoul', unit: 'source', profileId: PROFILE.id });

/** Exact cosine search. No source locks or DB transaction remain open during external embedding. */
export class SemanticSearchService {
  constructor(readonly db: DataSource, readonly config: ConfigService, readonly embedding: EmbeddingClient, readonly recorder: SearchIndexRecorder) {}
  isReviewsEnabled(): boolean { return this.config.get('AI_SEARCH_REVIEWS_ENABLED') === 'true'; }
  isInquiriesEnabled(): boolean { return this.config.get('AI_SEARCH_INQUIRIES_ENABLED') === 'true'; }

  async searchReviews(input: ReviewSearchInput, context: ToolExecutionContext): Promise<ReviewSearchResult> {
    return (await this.searchReviewsWithTrace(input, context)).result;
  }

  /** Evaluation-only diagnostics are never included in the LLM tool result. */
  async searchReviewsWithTrace(input: ReviewSearchInput, context: ToolExecutionContext): Promise<{ result: ReviewSearchResult; diagnostics: SearchDiagnostics }> {
    const started = performance.now();
    const diagnostics: SearchDiagnostics = { embeddingUsage: null, embeddingMs: 0, databaseMs: 0, totalMs: 0, candidates: [], invalidatedSourceCount: 0 };
    let scope = baseScope();
    let coverage: SearchCoverage | null = null;
    const finish = (result: ReviewSearchResult) => { diagnostics.totalMs = performance.now() - started; return { result, diagnostics }; };
    if (!isAdminToolContext(context)) return finish(searchFailure('forbidden', 'FORBIDDEN', scope));
    if (!this.isReviewsEnabled()) return finish(searchFailure('unsupported', 'REVIEWS_DISABLED', scope));
    const parsed = reviewSearchInput.safeParse(input);
    if (!parsed.success) return finish(searchFailure('invalid_arguments', 'INVALID_ARGUMENTS', scope));
    const args = parsed.data;
    scope = { ...scope, ...args, query: normalizeSearchText(args.query), categoryName: args.categoryName ? normalizeSearchText(args.categoryName) : undefined, take: args.take ?? 5 };
    try {
      this.checkAbort(context);
      const formattedQuery = queryInput(args.query);
      const inspect = await this.snapshot(context, async manager => {
        await this.recorder.assertProfile(manager);
        return this.coverage(manager, args);
      }, diagnostics);
      coverage = inspect.coverage;
      scope.checkedAt = inspect.checkedAt;
      if (!coverage.total) return finish(this.result('no_data', scope, coverage));
      if (!inspect.chunkCount) return finish(this.result(this.emptyStatus(coverage), scope, coverage));
      if (this.embedding.model !== PROFILE.model || this.embedding.dimensions !== PROFILE.dimensions) throw new SearchError('PROFILE_MISMATCH');
      if (!this.embedding.isEnabled()) throw new SearchError('EMBEDDING_DISABLED');
      const embeddingStarted = performance.now();
      let vectors: number[][];
      try {
        const embedded = await this.embedding.embed([formattedQuery], context.signal);
        vectors = embedded.vectors;
        diagnostics.embeddingUsage = embedded.usage;
      } finally { diagnostics.embeddingMs = performance.now() - embeddingStarted; }
      if (!Array.isArray(vectors) || vectors.length !== 1) throw new SearchError('INVALID_EMBEDDING');
      assertSearchVector(vectors[0]);
      this.checkAbort(context);
      const candidates = await this.snapshot(context, async manager => {
        await this.recorder.assertProfile(manager);
        const filter = this.filter(args, [PROFILE.id, JSON.stringify(vectors[0])]);
        return manager.query(`WITH eligible AS (${this.eligible(manager, filter.where)})
          SELECT c.review_id,c.source_version,c.chunk_index,c.embedding <=> $2::vector AS distance
          FROM eligible e JOIN ${searchTable(manager, 'review_search_chunks')} c ON c.review_id=e.id AND c.profile_id=$1 AND c.source_version=e.search_version
          WHERE e.ready AND c.content_hash=e.content_hash AND vector_norm(c.embedding)>0
          ORDER BY distance,c.review_id,c.chunk_index LIMIT 10`, filter.values) as Promise<Candidate[]>;
      }, diagnostics);
      diagnostics.candidates = candidates;
      // A separate last snapshot sees edits/deletes/metadata moves that happened after ranking.
      return finish(await this.snapshot(context, async manager => {
        await this.recorder.assertProfile(manager);
        const currentCoverage = await this.coverage(manager, args);
        coverage = currentCoverage.coverage;
        scope.checkedAt = currentCoverage.checkedAt;
        const filter = this.filter(args, [PROFILE.id, candidates.map(candidate => candidate.review_id)]);
        const current: CurrentChunk[] = candidates.length ? await manager.query(`WITH eligible AS (${this.eligible(manager, filter.where)})
          SELECT c.review_id,c.source_version,c.chunk_index,c.text,c.content_hash,e.content_hash AS job_hash,
            e.product_id,e.rating,e.comment,e."createdAt" AT TIME ZONE 'UTC' AS created_at
          FROM eligible e JOIN ${searchTable(manager, 'review_search_chunks')} c ON c.review_id=e.id AND c.profile_id=$1 AND c.source_version=e.search_version
          WHERE e.ready AND e.id=ANY($2::int[]) AND vector_norm(c.embedding)>0`, filter.values) : [];
        const documents = new Map<number, ReturnType<typeof reviewDocument>>();
        const valid: (CurrentChunk & { distance: number })[] = [];
        const invalid = new Set<number>();
        const corrupt = new Set<number>();
        for (const candidate of candidates) {
          const row = current.find(chunk => chunk.review_id === candidate.review_id && chunk.chunk_index === candidate.chunk_index && chunk.source_version === candidate.source_version);
          if (!row || !Number.isFinite(candidate.distance)) { invalid.add(candidate.review_id); continue; }
          try {
            let document = documents.get(row.review_id);
            if (!document) { document = reviewDocument(row.comment); documents.set(row.review_id, document); }
            if (document.contentHash !== row.job_hash || row.content_hash !== document.contentHash || row.text !== document.chunks[row.chunk_index]?.text) {
              corrupt.add(row.review_id);
              invalid.add(row.review_id); continue;
            }
            valid.push({ ...row, distance: candidate.distance });
          } catch { corrupt.add(row.review_id); invalid.add(row.review_id); }
        }
        diagnostics.invalidatedSourceCount = invalid.size;
        // SQL readiness cannot detect an out-of-band body/text edit. Correct the counts
        // for corrupt sources discovered by comparison with the original in this snapshot.
        if (corrupt.size) coverage = { ...coverage, ready: coverage.ready - corrupt.size,
          failed: coverage.failed + corrupt.size, partial: true };
        const grouped = new Map<number, ReviewSearchSource>();
        let remaining = 12000;
        let truncated = false;
        for (const row of valid) {
          if (invalid.has(row.review_id)) continue;
          let source = grouped.get(row.review_id);
          if (!source && grouped.size >= (args.take ?? 5)) continue;
          if (source && source.quotes.length >= 2) continue;
          const points = Array.from(row.text);
          if (!remaining) { truncated = true; continue; }
          const text = points.slice(0, remaining).join('');
          if (points.length > remaining) truncated = true;
          remaining -= Math.min(points.length, remaining);
          if (!source) {
            source = { sourceType: 'review', id: row.review_id, productId: row.product_id, rating: row.rating, createdAt: row.created_at.toISOString(), quotes: [] };
            grouped.set(row.review_id, source);
          }
          source.quotes.push({ chunkIndex: row.chunk_index, text });
        }
        const sources = [...grouped.values()];
        const candidateSourceCount = new Set(candidates.map(candidate => candidate.review_id)).size;
        const status = sources.length ? 'ok' : !coverage.total ? 'no_data' : this.emptyStatus(coverage);
        // Ready chunks may have changed since ranking. That is an incomplete search,
        // rather than evidence that no searchable chunks exist.
        const result = status === 'no_candidates' && currentCoverage.chunkCount > 0
          ? searchFailure('unavailable', 'SOURCE_CHANGED', scope, { ...coverage, partial: true })
          : this.result(status, scope, coverage);
        result.data = { sources, candidateChunkCount: candidates.length, omittedSourceCount: candidateSourceCount - sources.length, contextTruncated: truncated };
        if (invalid.size && result.coverage) result.coverage = { ...result.coverage, partial: true };
        this.checkAbort(context);
        return result;
      }, diagnostics));
    } catch (error) {
      const code = context.signal?.aborted ? 'ABORTED' : error instanceof SearchError ? error.code : 'INDEX_STORAGE_FAILED';
      if (code === 'INVALID_INPUT') return finish(searchFailure('invalid_arguments', code, scope, coverage));
      return finish(searchFailure('unavailable', code, scope, coverage));
    }
  }

  async searchInquiries(input: InquirySearchInput, context: ToolExecutionContext): Promise<InquirySearchResult> {
    return (await this.searchInquiriesWithTrace(input, context)).result;
  }

  /** Evaluation-only diagnostics are never included in the LLM tool result. */
  async searchInquiriesWithTrace(input: InquirySearchInput, context: ToolExecutionContext): Promise<{ result: InquirySearchResult; diagnostics: InquirySearchDiagnostics }> {
    const started = performance.now();
    const diagnostics: InquirySearchDiagnostics = { embeddingUsage: null, embeddingMs: 0, databaseMs: 0, totalMs: 0, candidates: [], invalidatedSourceCount: 0 };
    let scope = inquiryBaseScope();
    let coverage: SearchCoverage | null = null;
    const finish = (result: InquirySearchResult) => { diagnostics.totalMs = performance.now() - started; return { result, diagnostics }; };
    if (!isAdminToolContext(context)) return finish(inquirySearchFailure('forbidden', 'FORBIDDEN', scope));
    if (!this.isInquiriesEnabled()) return finish(inquirySearchFailure('unsupported', 'INQUIRIES_DISABLED', scope));
    const parsed = inquirySearchInput.safeParse(input);
    if (!parsed.success) return finish(inquirySearchFailure('invalid_arguments', 'INVALID_ARGUMENTS', scope));
    const args = parsed.data;
    scope = { ...scope, ...args, query: normalizeSearchText(args.query), categoryName: args.categoryName ? normalizeSearchText(args.categoryName) : undefined, take: args.take ?? 5 };
    try {
      this.checkAbort(context);
      const formattedQuery = queryInput(args.query);
      const inspect = await this.snapshot(context, async manager => {
        await this.recorder.assertProfile(manager);
        return this.inquiryCoverage(manager, args);
      }, diagnostics);
      coverage = inspect.coverage;
      scope.checkedAt = inspect.checkedAt;
      if (!coverage.total) return finish(this.inquiryResult('no_data', scope, coverage));
      if (!inspect.chunkCount) return finish(this.inquiryResult(this.emptyStatus(coverage), scope, coverage));
      if (this.embedding.model !== PROFILE.model || this.embedding.dimensions !== PROFILE.dimensions) throw new SearchError('PROFILE_MISMATCH');
      if (!this.embedding.isEnabled()) throw new SearchError('EMBEDDING_DISABLED');
      const embeddingStarted = performance.now();
      let vectors: number[][];
      try {
        const embedded = await this.embedding.embed([formattedQuery], context.signal);
        vectors = embedded.vectors;
        diagnostics.embeddingUsage = embedded.usage;
      } finally { diagnostics.embeddingMs = performance.now() - embeddingStarted; }
      if (!Array.isArray(vectors) || vectors.length !== 1) throw new SearchError('INVALID_EMBEDDING');
      assertSearchVector(vectors[0]);
      this.checkAbort(context);
      const candidates = await this.snapshot(context, async manager => {
        await this.recorder.assertProfile(manager);
        const filter = this.inquiryFilter(args, [PROFILE.id, JSON.stringify(vectors[0])]);
        return manager.query(`WITH eligible AS (${this.inquiryEligible(manager, filter.where)})
          SELECT c.inquiry_id,c.source_version,c.chunk_index,c.embedding <=> $2::vector AS distance
          FROM eligible e JOIN ${searchTable(manager, 'inquiry_search_chunks')} c ON c.inquiry_id=e.id AND c.profile_id=$1 AND c.source_version=e.search_version
          WHERE e.ready AND c.content_hash=e.content_hash AND vector_norm(c.embedding)>0
          ORDER BY distance,c.inquiry_id,c.chunk_index LIMIT 10`, filter.values) as Promise<InquiryCandidate[]>;
      }, diagnostics);
      diagnostics.candidates = candidates;
      // A separate last snapshot sees edits/deletes/metadata moves that happened after ranking.
      return finish(await this.snapshot(context, async manager => {
        await this.recorder.assertProfile(manager);
        const currentCoverage = await this.inquiryCoverage(manager, args);
        coverage = currentCoverage.coverage;
        scope.checkedAt = currentCoverage.checkedAt;
        const filter = this.inquiryFilter(args, [PROFILE.id, candidates.map(candidate => candidate.inquiry_id)]);
        const current: InquiryCurrentChunk[] = candidates.length ? await manager.query(`WITH eligible AS (${this.inquiryEligible(manager, filter.where)})
          SELECT c.inquiry_id,c.source_version,c.chunk_index,c.text,c.content_hash,e.content_hash AS job_hash,
            e.product_id,e.status,e.title,e.content,e.answer,e.is_secret,e."createdAt" AT TIME ZONE 'UTC' AS created_at
          FROM eligible e JOIN ${searchTable(manager, 'inquiry_search_chunks')} c ON c.inquiry_id=e.id AND c.profile_id=$1 AND c.source_version=e.search_version
          WHERE e.ready AND e.id=ANY($2::int[]) AND vector_norm(c.embedding)>0`, filter.values) : [];
        // Public/current candidates only: a source that became secret must not remain in result counts.
        const publicCandidates = candidates.filter(candidate => current.some(row => row.inquiry_id === candidate.inquiry_id &&
          row.source_version === candidate.source_version && row.chunk_index === candidate.chunk_index));
        const documents = new Map<number, ReturnType<typeof inquiryDocument>>();
        const valid: (InquiryCurrentChunk & { distance: number })[] = [];
        const invalid = new Set<number>();
        const corrupt = new Set<number>();
        for (const candidate of candidates) {
          const row = current.find(chunk => chunk.inquiry_id === candidate.inquiry_id && chunk.chunk_index === candidate.chunk_index && chunk.source_version === candidate.source_version);
          if (!row || !Number.isFinite(candidate.distance)) { invalid.add(candidate.inquiry_id); continue; }
          try {
            let document = documents.get(row.inquiry_id);
            if (!document) { document = inquiryDocument({ title: row.title, content: row.content, answer: row.answer, isSecret: row.is_secret });
              if (!document) throw new SearchError('SOURCE_CHANGED');
              documents.set(row.inquiry_id, document); }
            if (document.contentHash !== row.job_hash || row.content_hash !== document.contentHash || row.text !== document.chunks[row.chunk_index]?.text) {
              corrupt.add(row.inquiry_id);
              invalid.add(row.inquiry_id); continue;
            }
            valid.push({ ...row, distance: candidate.distance });
          } catch { corrupt.add(row.inquiry_id); invalid.add(row.inquiry_id); }
        }
        diagnostics.invalidatedSourceCount = invalid.size;
        // SQL readiness cannot detect an out-of-band body/text edit. Correct the counts
        // for corrupt sources discovered by comparison with the original in this snapshot.
        if (corrupt.size) coverage = { ...coverage, ready: coverage.ready - corrupt.size,
          failed: coverage.failed + corrupt.size, partial: true };
        const grouped = new Map<number, InquirySearchSource>();
        let remaining = 12000;
        let truncated = false;
        for (const row of valid) {
          if (invalid.has(row.inquiry_id)) continue;
          let source = grouped.get(row.inquiry_id);
          if (!source && grouped.size >= (args.take ?? 5)) continue;
          if (source && source.quotes.length >= 2) continue;
          const points = Array.from([normalizeSearchText(row.title) ? `[문의 제목]\n${normalizeSearchText(row.title)}` : '', row.text].filter(Boolean).join('\n\n'));
          if (!remaining) { truncated = true; continue; }
          const text = points.slice(0, remaining).join('');
          if (points.length > remaining) truncated = true;
          remaining -= Math.min(points.length, remaining);
          if (!source) {
            source = { sourceType: 'inquiry', id: row.inquiry_id, productId: row.product_id, status: row.status, title: normalizeSearchText(row.title),
              hasContent: !!normalizeSearchText(row.content), hasAnswer: !!normalizeSearchText(row.answer), createdAt: row.created_at.toISOString(), quotes: [] };
            grouped.set(row.inquiry_id, source);
          }
          source.quotes.push({ chunkIndex: row.chunk_index, text });
        }
        const sources = [...grouped.values()];
        const candidateSourceCount = new Set(publicCandidates.map(candidate => candidate.inquiry_id)).size;
        const status = sources.length ? 'ok' : !coverage.total ? 'no_data' : this.emptyStatus(coverage);
        // Ready chunks may have changed since ranking. That is an incomplete search,
        // rather than evidence that no searchable chunks exist.
        const result = status === 'no_candidates' && currentCoverage.chunkCount > 0
          ? inquirySearchFailure('unavailable', 'SOURCE_CHANGED', scope, { ...coverage, partial: true })
          : this.inquiryResult(status, scope, coverage);
        result.data = { sources, candidateChunkCount: publicCandidates.length, omittedSourceCount: candidateSourceCount - sources.length, contextTruncated: truncated };
        if (invalid.size && result.coverage) result.coverage = { ...result.coverage, partial: true };
        this.checkAbort(context);
        return result;
      }, diagnostics));
    } catch (error) {
      const code = context.signal?.aborted ? 'ABORTED' : error instanceof SearchError ? error.code : 'INDEX_STORAGE_FAILED';
      if (code === 'INVALID_INPUT') return finish(inquirySearchFailure('invalid_arguments', code, scope, coverage));
      return finish(inquirySearchFailure('unavailable', code, scope, coverage));
    }
  }

  private checkAbort(context: ToolExecutionContext): void { if (context.signal?.aborted) throw new SearchError('ABORTED'); }

  private async snapshot<T>(context: ToolExecutionContext, work: (manager: EntityManager) => Promise<T>, diagnostics: Pick<SearchDiagnostics, 'databaseMs'>): Promise<T> {
    this.checkAbort(context);
    const started = performance.now();
    const runner = this.db.createQueryRunner();
    let connected = false;
    let closing: Promise<unknown> | undefined;
    const cancel = () => {
      // This physical client belongs exclusively to this QueryRunner. pg discards an ending client instead of returning it to the pool.
      const client = (runner as QueryRunner & { databaseConnection?: { end(): Promise<void> } }).databaseConnection;
      if (client && !closing) closing = client.end().catch(() => undefined);
    };
    try {
      await this.connect(runner, context.signal);
      connected = true;
      context.signal?.addEventListener('abort', cancel, { once: true });
      this.checkAbort(context);
      await runner.startTransaction('REPEATABLE READ');
      await runner.query('SET TRANSACTION READ ONLY');
      await runner.query("SET LOCAL statement_timeout = '3s'");
      this.checkAbort(context);
      const result = await work(runner.manager);
      this.checkAbort(context);
      await runner.commitTransaction();
      return result;
    } finally {
      context.signal?.removeEventListener('abort', cancel);
      if (connected) {
        if (runner.isTransactionActive && !closing) await runner.rollbackTransaction().catch(() => undefined);
        await closing;
        await runner.release();
      }
      diagnostics.databaseMs += performance.now() - started;
    }
  }

  private async connect(runner: QueryRunner, signal?: AbortSignal): Promise<void> {
    const pending = runner.connect();
    if (!signal) { await pending; return; }
    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new SearchError('ABORTED'));
    });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      await Promise.race([pending, aborted]);
    } catch (error) {
      // pg does not expose canceling a pool waiter. Release its eventual connection
      // without opening a transaction, and consume failures after the request ends.
      void pending.then(() => runner.release()).catch(() => undefined);
      throw error;
    } finally { signal.removeEventListener('abort', onAbort); }
  }

  private filter(args: ReviewSearchInput, initial: unknown[]): { where: string; values: unknown[] } {
    const values = [...initial];
    const where = ['TRUE'];
    const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
    if (args.productIds !== undefined) add('r.product_id=ANY(?::int[])', args.productIds);
    if (args.categoryIds !== undefined) add('p.category_id=ANY(?::int[])', args.categoryIds);
    if (args.maxRating !== undefined) add('r.rating<=?::int', args.maxRating);
    if (args.startDate) add('r."createdAt">=(?::timestamptz AT TIME ZONE \'UTC\')', kstDayStart(args.startDate));
    if (args.endDate) add('r."createdAt"<(?::timestamptz AT TIME ZONE \'UTC\')', kstDayEndExclusive(args.endDate));
    return { where: where.join(' AND '), values };
  }

  private eligible(manager: EntityManager, where: string): string {
    return `SELECT r.*,j.content_hash,j.chunk_count,j.status,
      (j.status='done' AND j.chunk_count=s.count AND s.healthy) AS ready,s.count AS stored_count
      FROM ${searchTable(manager, 'reviews')} r JOIN ${searchTable(manager, 'products')} p ON p.id=r.product_id
      LEFT JOIN ${searchTable(manager, 'search_index_jobs')} j ON j.review_id=r.id AND j.source_version=r.search_version AND j.profile_id=$1
      LEFT JOIN LATERAL (SELECT count(*)::int AS count,
        COALESCE(bool_and(c.source_version=r.search_version AND c.content_hash=j.content_hash AND vector_norm(c.embedding)>0),true)
        AND (count(*)=0 OR (min(c.chunk_index)=0 AND max(c.chunk_index)=count(*)-1)) AS healthy
        FROM ${searchTable(manager, 'review_search_chunks')} c WHERE c.review_id=r.id AND c.profile_id=$1) s ON true
      WHERE ${where}`;
  }

  private async coverage(manager: EntityManager, args: ReviewSearchInput): Promise<{ coverage: SearchCoverage; chunkCount: number; checkedAt: string }> {
    const filter = this.filter(args, [PROFILE.id]);
    const [row] = await manager.query(`WITH eligible AS (${this.eligible(manager, filter.where)})
      SELECT count(*)::int AS total,count(*) FILTER (WHERE ready)::int AS ready,
        count(*) FILTER (WHERE status='failed' OR (status='done' AND NOT ready))::int AS failed,
        COALESCE(sum(stored_count) FILTER (WHERE ready),0)::int AS chunks,clock_timestamp() AS checked_at FROM eligible`, filter.values);
    const pending = row.total - row.ready - row.failed;
    return { coverage: { total: row.total, ready: row.ready, pending, failed: row.failed, partial: pending > 0 || row.failed > 0 },
      chunkCount: row.chunks, checkedAt: row.checked_at.toISOString() };
  }

  private inquiryFilter(args: InquirySearchInput, initial: unknown[]): { where: string; values: unknown[] } {
    const values = [...initial];
    const where = ['r.is_secret=false'];
    const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
    if (args.productIds !== undefined) add('r.product_id=ANY(?::int[])', args.productIds);
    if (args.categoryIds !== undefined) add('p.category_id=ANY(?::int[])', args.categoryIds);
    if (args.status !== undefined) add('r.status=?', args.status);
    if (args.startDate) add('r."createdAt">=(?::timestamptz AT TIME ZONE \'UTC\')', kstDayStart(args.startDate));
    if (args.endDate) add('r."createdAt"<(?::timestamptz AT TIME ZONE \'UTC\')', kstDayEndExclusive(args.endDate));
    return { where: where.join(' AND '), values };
  }

  private inquiryEligible(manager: EntityManager, where: string): string {
    return `SELECT r.*,j.content_hash,j.chunk_count,j.status AS index_status,
      (j.status='done' AND j.chunk_count=s.count AND s.healthy) AS ready,s.count AS stored_count
      FROM ${searchTable(manager, 'inquiries')} r JOIN ${searchTable(manager, 'products')} p ON p.id=r.product_id
      LEFT JOIN ${searchTable(manager, 'search_index_jobs')} j ON j.inquiry_id=r.id AND j.source_version=r.search_version AND j.profile_id=$1
      LEFT JOIN LATERAL (SELECT count(*)::int AS count,
        COALESCE(bool_and(c.source_version=r.search_version AND c.content_hash=j.content_hash AND vector_norm(c.embedding)>0),true)
        AND (count(*)=0 OR (min(c.chunk_index)=0 AND max(c.chunk_index)=count(*)-1)) AS healthy
        FROM ${searchTable(manager, 'inquiry_search_chunks')} c WHERE c.inquiry_id=r.id AND c.profile_id=$1) s ON true
      WHERE ${where}`;
  }

  private async inquiryCoverage(manager: EntityManager, args: InquirySearchInput): Promise<{ coverage: SearchCoverage; chunkCount: number; checkedAt: string }> {
    const filter = this.inquiryFilter(args, [PROFILE.id]);
    const [row] = await manager.query(`WITH eligible AS (${this.inquiryEligible(manager, filter.where)})
      SELECT count(*)::int AS total,count(*) FILTER (WHERE ready)::int AS ready,
        count(*) FILTER (WHERE index_status='failed' OR (index_status='done' AND NOT ready))::int AS failed,
        COALESCE(sum(stored_count) FILTER (WHERE ready),0)::int AS chunks,clock_timestamp() AS checked_at FROM eligible`, filter.values);
    const pending = row.total - row.ready - row.failed;
    return { coverage: { total: row.total, ready: row.ready, pending, failed: row.failed, partial: pending > 0 || row.failed > 0 },
      chunkCount: row.chunks, checkedAt: row.checked_at.toISOString() };
  }

  private emptyStatus(coverage: SearchCoverage): ReviewSearchResult['status'] { return coverage.failed ? 'unavailable' : coverage.pending ? 'indexing' : 'no_candidates'; }

  private inquiryResult(status: InquirySearchResult['status'], scope: InquirySearchScope, coverage: SearchCoverage): InquirySearchResult {
    if (status === 'unavailable' || status === 'indexing') return inquirySearchFailure(status, status === 'unavailable' ? 'INDEX_FAILED' : 'INDEX_PENDING', scope, coverage);
    return { status, mode: 'semantic', scope, coverage, data: { sources: [], candidateChunkCount: 0, omittedSourceCount: 0, contextTruncated: false }, error: null };
  }

  private result(status: ReviewSearchResult['status'], scope: ReviewSearchScope, coverage: SearchCoverage): ReviewSearchResult {
    if (status === 'unavailable' || status === 'indexing') return searchFailure(status, status === 'unavailable' ? 'INDEX_FAILED' : 'INDEX_PENDING', scope, coverage);
    return { status, mode: 'semantic', scope, coverage, data: { sources: [], candidateChunkCount: 0, omittedSourceCount: 0, contextTruncated: false }, error: null };
  }
}
