import { getPaginateProducts } from './products';
import type { PaginatedProducts } from '@/model/product';

/** 기획전 조건은 공개 카탈로그에 적용한다. 페이지 하나를 전체 상품으로 오인하지 않는다. */
export async function getEventCatalog() {
  const params = { limit: 100, sortBy: 'createdAt' as const, sortOrder: 'DESC' as const };
  const first = (await getPaginateProducts({ ...params, page: 1 })).data as PaginatedProducts;
  if (!Array.isArray(first.data) || !Number.isInteger(first.meta?.lastPage)) throw new Error('상품 목록을 확인할 수 없습니다.');
  const rest = await Promise.all(Array.from({ length: Math.max(0, first.meta.lastPage - 1) }, (_, index) => getPaginateProducts({ ...params, page: index + 2 })));
  const products = [first, ...rest.map((response) => response.data as PaginatedProducts)].flatMap((page) => {
    if (!Array.isArray(page.data)) throw new Error('상품 목록을 확인할 수 없습니다.');
    return page.data.filter(Boolean);
  });
  return [...new Map(products.map((product) => [product.id, product])).values()];
}
