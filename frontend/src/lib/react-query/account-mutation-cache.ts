import {
  MutationCache,
  type MutationOptions,
  type MutationState,
  type QueryClient,
} from '@tanstack/react-query';
import { authRevision } from '../../service/auth-session';
import { CanceledError } from 'axios';

/** A late mutation must not update the next account's cache, alerts, or routes. */
export class AccountMutationCache extends MutationCache {
  override build<TData, TError, TVariables, TContext>(
    client: QueryClient,
    options: MutationOptions<TData, TError, TVariables, TContext>,
    state?: MutationState<TData, TError, TVariables, TContext>
  ) {
    const revision = authRevision();
    const mutation = super.build(client, options, state);
    const setOptions = mutation.setOptions.bind(mutation);
    mutation.setOptions = (next) => {
      const mutationFn = next.mutationFn;
      const onMutate = next.onMutate;
      const current = () =>
        next.mutationKey?.[0] === 'auth' || revision === authRevision();
      setOptions({
        ...next,
        // An async onMutate, an offline pause or a retry can postpone the actual
        // request until after login. Never send that old intent as the next user.
        mutationFn: mutationFn
          ? (...args) => {
              if (!current())
                return Promise.reject(new CanceledError('Account changed'));
              return mutationFn(...args);
            }
          : undefined,
        onMutate: onMutate
          ? (...args) => {
              if (!current()) throw new CanceledError('Account changed');
              return onMutate(...args);
            }
          : undefined,
        onSuccess: (...args) =>
          current() ? next.onSuccess?.(...args) : undefined,
        onError: (...args) => (current() ? next.onError?.(...args) : undefined),
        onSettled: (...args) =>
          current() ? next.onSettled?.(...args) : undefined,
      });
    };
    mutation.setOptions(mutation.options);
    // mutate(..., {onSuccess}) callbacks live on the observer, outside MutationOptions.
    const addObserver = mutation.addObserver.bind(mutation);
    const removeObserver = mutation.removeObserver.bind(mutation);
    type Observer = Parameters<typeof mutation.addObserver>[0];
    const observers = new Map<Observer, Observer['onMutationUpdate']>();
    mutation.addObserver = (observer) => {
      if (!observers.has(observer)) {
        const update = observer.onMutationUpdate;
        observers.set(observer, update);
        observer.onMutationUpdate = (action) => {
          if (
            mutation.options.mutationKey?.[0] === 'auth' ||
            revision === authRevision()
          )
            update.call(observer, action);
          // Dropping the callback must also release the old pending UI state.
          // reset() notifies subscribers without a success/error action, so it
          // cannot invoke the stale per-call callbacks.
          else observer.reset();
        };
      }
      addObserver(observer);
    };
    mutation.removeObserver = (observer) => {
      const update = observers.get(observer);
      if (update) observer.onMutationUpdate = update;
      observers.delete(observer);
      removeObserver(observer);
    };
    return mutation;
  }
}
