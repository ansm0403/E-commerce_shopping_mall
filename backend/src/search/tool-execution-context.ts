import { randomUUID } from 'node:crypto';

/** Created by authenticated controllers or internal evaluation code; never from model arguments. */
export interface ToolExecutionContext {
  readonly actorId: number;
  readonly roles: readonly string[];
  readonly requestId: string;
  readonly origin: 'http' | 'evaluation';
  readonly signal?: AbortSignal;
}

export function adminToolContext(actorId: number, roles: readonly string[], requestId: string = randomUUID(), signal?: AbortSignal): ToolExecutionContext {
  return Object.freeze({ actorId, roles: Object.freeze([...roles]), requestId, origin: 'http', signal });
}

export function evaluationToolContext(requestId: string, signal?: AbortSignal): ToolExecutionContext {
  return Object.freeze({ actorId: 0, roles: Object.freeze(['admin']), requestId, origin: 'evaluation', signal });
}

export function isAdminToolContext(context?: ToolExecutionContext): context is ToolExecutionContext {
  return !!context && typeof context.requestId === 'string' && context.requestId.length > 0 &&
    Array.isArray(context.roles) && context.roles.includes('admin') &&
    ((context.origin === 'http' && Number.isSafeInteger(context.actorId) && context.actorId > 0) ||
      (context.origin === 'evaluation' && context.actorId === 0));
}
