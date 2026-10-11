import { createHash } from 'crypto';
import { beautyProductsData } from '../../data/beauty-products';
import { clothingProductsData } from '../../data/clothing-products';
import { shoesProductsData } from '../../data/shoes-products';
import { bookProductsData } from '../../data/book-products';
import { foodProductsData } from '../../data/food-products';
import { livingProductsData } from '../../data/living-products';

export const mockProductCatalog = [
  ...beautyProductsData, ...clothingProductsData, ...shoesProductsData,
  ...bookProductsData, ...foodProductsData, ...livingProductsData,
].map((product) => ({
  ...product,
  seedKey: `mock:${createHash('sha256').update(JSON.stringify([
    product.category, product.brand, product.name,
  ])).digest('hex')}`,
}));
