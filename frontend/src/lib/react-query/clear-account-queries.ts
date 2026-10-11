import type { QueryClient } from '@tanstack/react-query';
import { cancelAccountRequests } from '../axios/axios-http-client';
import { authRevision } from '../../service/auth-session';

/** Clear account data while keeping the query observed by the root AuthProvider. */
export async function clearAccountQueries(client: QueryClient) {
  const revision = authRevision();
  if (typeof window !== 'undefined') cancelAccountRequests();
  const predicate = ({ queryKey }: { queryKey: readonly unknown[] }) =>
    !(
      ['categories', 'category'].includes(String(queryKey[0])) ||
      (queryKey[0] === 'products' &&
        (queryKey.length === 1 || queryKey[1] === 'detail')) ||
      (queryKey[0] === 'paginate' && queryKey[1] === 'products')
    );
  await client.cancelQueries({ predicate });
  if (revision !== authRevision()) return;
  // Removing an observed auth query detaches AuthProvider from subsequent
  // setQueryData calls: the token changes, but the UI stays logged out until reload.
  client.removeQueries({
    predicate: (query) =>
      predicate(query) &&
      !(
        query.queryKey.length === 2 &&
        query.queryKey[0] === 'auth' &&
        query.queryKey[1] === 'user'
      ),
  });
}
