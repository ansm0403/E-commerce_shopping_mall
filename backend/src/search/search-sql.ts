import type { EntityManager } from 'typeorm';

/** Only server-owned table names enter SQL; schema is escaped by the PostgreSQL driver. */
export function searchTable(manager: EntityManager, name: 'reviews' | 'inquiries' | 'products' | 'categories' | 'search_index_jobs' | 'search_embedding_profiles' | 'review_search_chunks' | 'inquiry_search_chunks'): string {
  const schema = (manager.connection.options as { schema?: string }).schema ?? 'public';
  return `${manager.connection.driver.escape(schema)}.${manager.connection.driver.escape(name)}`;
}

/** PostgreSQL TypeORM returns UPDATE/DELETE as [records, affected], unlike SELECT/INSERT. */
export function mutationRows<Row>(result: unknown): Row[] {
  if (!Array.isArray(result)) throw new Error('INVALID_MUTATION_RESULT');
  return (Array.isArray(result[0]) && typeof result[1] === 'number' ? result[0] : result) as Row[];
}
