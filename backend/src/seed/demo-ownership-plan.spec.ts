import { planMockOwnership, LegacyProduct } from './demo-ownership-plan';
import { mockProductCatalog } from '../common/seeds/mock-product-catalog';

const fixture = { name: 'Sprite', brand: 'Coca-Cola', description: 'Lemon soda', imageUrl: 'https://example.com/sprite.png', seedKey: 'mock:sprite' };
const product: LegacyProduct = { id: 5, ...fixture, sellerId: null, seedKey: null, urls: [fixture.imageUrl] };

describe('mock ownership repair', () => {
  it('uses a unique stable identity for every catalog fixture', () => {
    expect(new Set(mockProductCatalog.map((p) => p.seedKey)).size).toBe(mockProductCatalog.length);
  });
  it('matches the legacy catalog and becomes a no-op after repair', () => {
    expect(planMockOwnership([product], [fixture], 7).updates).toEqual([{ id: 5, seedKey: fixture.seedKey, sellerId: 7 }]);
    expect(planMockOwnership([{ ...product, seedKey: fixture.seedKey, sellerId: 7 }], [fixture], 7).updates).toEqual([]);
  });

  it('preserves registered products and unrelated unowned products', () => {
    expect(planMockOwnership([
      { ...product, sellerId: 9 },
      { ...product, id: 6, description: 'Registered product' },
      { ...product, id: 8, urls: ['/uploads/sprite.png'] },
    ], [fixture], 7).updates).toEqual([]);
  });

  it('refuses an ambiguous match', () => {
    const plan = planMockOwnership([product, { ...product, id: 6 }], [fixture], 7);
    expect(plan.updates).toEqual([]);
    expect(plan.ambiguous).toEqual([fixture.seedKey]);
  });

  it('prefers the stable key over an otherwise identical unowned product', () => {
    const keyed = { ...product, id: 6, seedKey: fixture.seedKey, sellerId: 7 };
    const plan = planMockOwnership([product, keyed], [fixture], 7);
    expect(plan.matchedIds).toEqual([6]); expect(plan.updates).toEqual([]);
  });

  it('does not identify a legacy fixture without its matching image', () => {
    expect(planMockOwnership([{ ...product, urls: [] }], [fixture], 7).matchedIds).toEqual([]);
  });

  it('keeps the seed key when switching the configured mock seller', () => {
    const plan = planMockOwnership([{ ...product, seedKey: fixture.seedKey, sellerId: 7 }], [fixture], 8, 7);
    expect(plan.updates).toEqual([{ id: 5, seedKey: fixture.seedKey, sellerId: 8 }]);
  });
  it('requires the old owner to be explicit before transferring a keyed fixture', () => {
    const plan = planMockOwnership([{ ...product, seedKey: fixture.seedKey, sellerId: 7 }], [fixture], 8);
    expect(plan.updates).toEqual([]);
    expect(plan.ambiguous).toEqual([fixture.seedKey]);
  });
});
