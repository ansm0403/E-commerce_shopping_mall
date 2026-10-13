import { LlmTimeoutError } from './llm-failure';

/** Shared across SDK requests in one turn; excludes tools, pacing and consumed events. */
export class LlmSdkWaitBudget {
  private consumedMs = 0;

  constructor(readonly limitMs: number) {
    if (!Number.isFinite(limitMs) || limitMs <= 0) throw new RangeError('INVALID_LLM_WAIT_BUDGET');
  }

  get remainingMs(): number { return Math.max(0, this.limitMs - this.consumedMs); }
  get spentMs(): number { return this.consumedMs; }

  consume(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError('INVALID_LLM_WAIT_DURATION');
    this.consumedMs += ms;
  }
}

function cancellationError(): Error {
  const error = new Error('LLM_REQUEST_ABORTED');
  error.name = 'AbortError';
  return error;
}

/** Own the deadline because the SDK reports its internal timeout as an ambiguous AbortError. */
export class LlmRequestDeadline {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private requestSpentMs = 0;
  private ended = false;
  private terminalError?: Error;
  private rejectPending?: (error: Error) => void;
  private readonly forwardCancellation = () => this.terminate(cancellationError());

  constructor(
    private readonly requestTimeoutMs: number,
    private readonly turnBudget: LlmSdkWaitBudget,
    private readonly callerSignal?: AbortSignal,
  ) {
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) throw new RangeError('INVALID_LLM_REQUEST_TIMEOUT');
    if (callerSignal?.aborted) this.forwardCancellation();
    else callerSignal?.addEventListener('abort', this.forwardCancellation, { once: true });
  }

  get closed(): boolean { return this.ended; }

  async wait<T>(operation: () => Promise<T>): Promise<T> {
    if (this.terminalError) throw this.terminalError;
    if (this.ended) throw cancellationError();
    if (this.rejectPending) throw new Error('LLM_DEADLINE_WAIT_IN_PROGRESS');

    const requestRemaining = Math.max(0, this.requestTimeoutMs - this.requestSpentMs);
    const turnRemaining = this.turnBudget.remainingMs;
    const scope = requestRemaining <= turnRemaining ? 'request' : 'turn';
    const remaining = Math.min(requestRemaining, turnRemaining);
    const timeoutError = (activeElapsedMs: number) => new LlmTimeoutError(
      scope,
      scope === 'request' ? this.requestTimeoutMs : this.turnBudget.limitMs,
      (scope === 'request' ? this.requestSpentMs : this.turnBudget.spentMs) + activeElapsedMs,
    );
    if (remaining <= 0) {
      const error = timeoutError(0);
      this.terminate(error);
      throw error;
    }

    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      this.rejectPending = reject;
      timer = setTimeout(() => this.terminate(timeoutError(Math.max(0, performance.now() - started))), remaining);
    });
    // Promise.race retains rejection handlers even if the SDK ignores cancellation and settles late.
    const pending = Promise.resolve().then(() => {
      if (this.terminalError) throw this.terminalError;
      if (this.ended) throw cancellationError();
      return operation();
    });
    try {
      return await Promise.race([cancelled, pending]);
    } finally {
      clearTimeout(timer);
      this.rejectPending = undefined;
      const elapsed = Math.max(0, performance.now() - started);
      this.requestSpentMs += elapsed;
      this.turnBudget.consume(elapsed);
    }
  }

  close(abortPending = false): void {
    if (this.ended) return;
    this.ended = true;
    this.callerSignal?.removeEventListener('abort', this.forwardCancellation);
    if (abortPending || this.rejectPending) this.terminate(cancellationError());
  }

  private terminate(error: Error): void {
    if (this.terminalError) return;
    this.terminalError = error;
    // Reject with our typed error before aborting fetch, which may otherwise win with AbortError.
    this.rejectPending?.(error);
    this.controller.abort();
  }
}
