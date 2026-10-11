export interface LegacyProduct {
  id: number;
  name: string;
  brand: string;
  description: string;
  sellerId: number | null;
  seedKey: string | null;
  urls: string[];
}

interface CatalogProduct {
  name: string;
  brand: string;
  description: string;
  imageUrl?: string;
  seedKey: string;
}

/** Only unambiguous catalog fixtures are eligible; registered products keep ownership. */
export function planMockOwnership(products: LegacyProduct[], catalog: CatalogProduct[], sellerId: number, previousSellerId?: number) {
  const updates: { id: number; seedKey: string; sellerId: number }[] = [];
  const ambiguous: string[] = [];
  const matchedIds: number[] = [];
  for (const fixture of catalog) {
    const keyed = products.filter((p) => p.seedKey === fixture.seedKey);
    const matches = keyed.length ? keyed : products.filter((p) =>
      p.seedKey == null && p.sellerId == null && p.name === fixture.name
      && p.brand === fixture.brand && p.description === fixture.description
      && !!fixture.imageUrl && p.urls.includes(fixture.imageUrl),
    );
    if (matches.length > 1) {
      ambiguous.push(fixture.seedKey);
      continue;
    }
    const product = matches[0];
    if (!product) continue;
    if (product.sellerId !== null && product.sellerId !== sellerId && product.sellerId !== previousSellerId) {
      ambiguous.push(fixture.seedKey);
      continue;
    }
    matchedIds.push(product.id);
    if (product.seedKey !== fixture.seedKey || product.sellerId !== sellerId) {
      updates.push({ id: product.id, seedKey: fixture.seedKey, sellerId });
    }
  }
  return { updates, ambiguous, matchedIds };
}
