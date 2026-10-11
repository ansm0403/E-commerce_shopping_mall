const REVISION = 'auth:revision';
let fallbackQueue: Promise<unknown> = Promise.resolve();
export function authRevision() {
  return typeof window === 'undefined'
    ? 'server'
    : localStorage.getItem(REVISION) || 'initial';
}
export function advanceAuthRevision() {
  const revision = crypto.randomUUID();
  localStorage.setItem(REVISION, revision);
  return revision;
}
export function supportsSessionLock() {
  return typeof navigator !== 'undefined' && !!navigator.locks;
}
/** Cookie-changing requests share a lock across tabs; unsupported browsers use one-tab mode. */
export async function withSessionLock<T>(action: () => Promise<T>): Promise<T> {
  if (supportsSessionLock())
    return navigator.locks.request('shopping-auth-session', action);
  const next = fallbackQueue.catch(() => undefined).then(action);
  fallbackQueue = next.catch(() => undefined);
  return next;
}
