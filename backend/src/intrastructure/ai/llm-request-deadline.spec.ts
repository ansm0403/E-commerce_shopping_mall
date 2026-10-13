import { LlmTimeoutError } from './llm-failure';
import { LlmRequestDeadline, LlmSdkWaitBudget } from './llm-request-deadline';

const observe = <T>(promise: Promise<T>) => promise.then(
  value => ({ value, error: undefined }),
  error => ({ value: undefined, error }),
);
const after = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));

describe('app-owned SDK request deadline', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('bounds an SDK promise that ignores its aborted signal with a typed request timeout', async () => {
    const caller = new AbortController();
    const budget = new LlmSdkWaitBudget(500);
    const deadline = new LlmRequestDeadline(100, budget, caller.signal);
    const operation = jest.fn(() => new Promise<never>(() => undefined));
    const result = observe(deadline.wait(operation));

    await jest.advanceTimersByTimeAsync(100);

    expect((await result).error).toBeInstanceOf(LlmTimeoutError);
    expect((await result).error).toMatchObject({ name: 'TimeoutError', timeoutScope: 'request', timeoutMs: 100, elapsedMs: 100 });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
    expect(budget.spentMs).toBe(100);
    expect(jest.getTimerCount()).toBe(0);
    deadline.close();
  });

  it('keeps caller cancellation distinct and does not retain a sensitive caller abort reason', async () => {
    const caller = new AbortController();
    const budget = new LlmSdkWaitBudget(500);
    const deadline = new LlmRequestDeadline(100, budget, caller.signal);
    const result = observe(deadline.wait(() => new Promise<never>(() => undefined)));
    await jest.advanceTimersByTimeAsync(20);
    caller.abort(new Error('secret@example.com API-key=secret'));

    const error = (await result).error;
    expect(error).toMatchObject({ name: 'AbortError', message: 'LLM_REQUEST_ABORTED' });
    expect(error).not.toBeInstanceOf(LlmTimeoutError);
    expect(error.message).not.toMatch(/secret|API-key/);
    expect(deadline.signal.aborted).toBe(true);
    expect(budget.spentMs).toBe(20);
    expect(jest.getTimerCount()).toBe(0);
    deadline.close();
  });

  it('does not invoke an SDK operation when its caller is already canceled', async () => {
    const caller = new AbortController();
    caller.abort();
    const budget = new LlmSdkWaitBudget(500);
    const deadline = new LlmRequestDeadline(100, budget, caller.signal);
    const operation = jest.fn(async () => 'late');

    await expect(deadline.wait(operation)).rejects.toMatchObject({ name: 'AbortError' });
    expect(operation).not.toHaveBeenCalled();
    expect(budget.spentMs).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    deadline.close();
  });

  it('clears successful wait timers and detaches the caller once the stream closes', async () => {
    const caller = new AbortController();
    const removeListener = jest.spyOn(caller.signal, 'removeEventListener');
    const budget = new LlmSdkWaitBudget(500);
    const deadline = new LlmRequestDeadline(100, budget, caller.signal);
    const result = deadline.wait(() => after(25, 'chunk'));

    await jest.advanceTimersByTimeAsync(25);
    expect(await result).toBe('chunk');
    expect(jest.getTimerCount()).toBe(0);
    deadline.close();
    deadline.close();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(deadline.closed).toBe(true);
    caller.abort();
    await jest.advanceTimersByTimeAsync(1000);
    expect(deadline.signal.aborted).toBe(false);
    expect(budget.spentMs).toBe(25);
  });

  it('clears timers after ordinary SDK failure without reclassifying that failure', async () => {
    const budget = new LlmSdkWaitBudget(500);
    const deadline = new LlmRequestDeadline(100, budget);
    const error = Object.assign(new Error('synthetic transport failure'), { code: 'ECONNRESET' });

    await expect(deadline.wait(async () => { throw error; })).rejects.toBe(error);
    expect(jest.getTimerCount()).toBe(0);
    deadline.close();
    await jest.advanceTimersByTimeAsync(1000);
    expect(deadline.signal.aborted).toBe(false);
  });

  it('pauses the request and turn clocks while the consumer handles a yielded chunk', async () => {
    const budget = new LlmSdkWaitBudget(200);
    const deadline = new LlmRequestDeadline(100, budget);
    const first = deadline.wait(() => after(20, 'first'));
    await jest.advanceTimersByTimeAsync(20);
    expect(await first).toBe('first');

    await jest.advanceTimersByTimeAsync(5000);
    expect(budget.spentMs).toBe(20);
    expect(deadline.signal.aborted).toBe(false);

    const second = deadline.wait(() => after(30, 'second'));
    await jest.advanceTimersByTimeAsync(30);
    expect(await second).toBe('second');
    expect(budget.spentMs).toBe(50);
    deadline.close();
  });

  it('forwards caller cancellation during a consumer pause and skips the next SDK wait', async () => {
    const caller = new AbortController();
    const budget = new LlmSdkWaitBudget(500);
    const deadline = new LlmRequestDeadline(100, budget, caller.signal);
    const first = deadline.wait(() => after(20, 'first'));
    await jest.advanceTimersByTimeAsync(20);
    await first;
    caller.abort();
    const operation = jest.fn(async () => 'late');

    expect(deadline.signal.aborted).toBe(true);
    await expect(deadline.wait(operation)).rejects.toMatchObject({ name: 'AbortError' });
    expect(operation).not.toHaveBeenCalled();
    expect(budget.spentMs).toBe(20);
    deadline.close();
  });

  it('spends one request limit across stream creation and successive next waits', async () => {
    const budget = new LlmSdkWaitBudget(500);
    const deadline = new LlmRequestDeadline(100, budget);
    const first = deadline.wait(() => after(40, 'stream'));
    await jest.advanceTimersByTimeAsync(40);
    await first;
    await jest.advanceTimersByTimeAsync(5000);

    const second = observe(deadline.wait(() => new Promise<never>(() => undefined)));
    await jest.advanceTimersByTimeAsync(59);
    expect(deadline.signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    expect((await second).error).toMatchObject({ timeoutScope: 'request', timeoutMs: 100, elapsedMs: 100 });
    expect(budget.spentMs).toBe(100);
    expect(jest.getTimerCount()).toBe(0);
    deadline.close();
  });

  it('shares a turn wait budget across requests and refuses an operation after exhaustion', async () => {
    const budget = new LlmSdkWaitBudget(80);
    const firstDeadline = new LlmRequestDeadline(100, budget);
    const first = firstDeadline.wait(() => after(50, 'tool request'));
    await jest.advanceTimersByTimeAsync(50);
    await first;
    firstDeadline.close();
    await jest.advanceTimersByTimeAsync(2000);

    const secondDeadline = new LlmRequestDeadline(100, budget);
    const second = observe(secondDeadline.wait(() => new Promise<never>(() => undefined)));
    await jest.advanceTimersByTimeAsync(30);
    expect((await second).error).toMatchObject({ timeoutScope: 'turn', timeoutMs: 80, elapsedMs: 80 });
    expect(budget.spentMs).toBe(80);
    expect(budget.remainingMs).toBe(0);
    secondDeadline.close();

    const thirdDeadline = new LlmRequestDeadline(100, budget);
    const operation = jest.fn(async () => 'late');
    await expect(thirdDeadline.wait(operation)).rejects.toMatchObject({ timeoutScope: 'turn', timeoutMs: 80, elapsedMs: 80 });
    expect(operation).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    thirdDeadline.close();
  });

  it('consumes late SDK rejection after a timeout without reopening a completed request', async () => {
    const budget = new LlmSdkWaitBudget(500);
    const deadline = new LlmRequestDeadline(100, budget);
    let rejectLate!: (error: Error) => void;
    const result = observe(deadline.wait(() => new Promise<never>((_resolve, reject) => { rejectLate = reject; })));
    await jest.advanceTimersByTimeAsync(100);
    expect((await result).error).toBeInstanceOf(LlmTimeoutError);
    deadline.close(true);

    rejectLate(new Error('late synthetic SDK error'));
    await jest.advanceTimersByTimeAsync(0);
    expect(deadline.closed).toBe(true);
    expect(budget.spentMs).toBe(100);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('closing an outstanding ignored-abort wait settles it and cleans its timer', async () => {
    const budget = new LlmSdkWaitBudget(500);
    const deadline = new LlmRequestDeadline(100, budget);
    const result = observe(deadline.wait(() => new Promise<never>(() => undefined)));
    await jest.advanceTimersByTimeAsync(10);
    deadline.close(true);

    expect((await result).error).toMatchObject({ name: 'AbortError' });
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.closed).toBe(true);
    expect(budget.spentMs).toBe(10);
    expect(jest.getTimerCount()).toBe(0);
  });
});
