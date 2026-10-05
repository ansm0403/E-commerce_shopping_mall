import { hasRole } from './roles';
import { applyWishToggle } from './react-query/wishlist-query-options';
import { wishlistImageUrl, type WishlistItem } from '../service/wishlist';
import { activeNavHref } from '../components/console/nav';
import { SELLER_NAV_ITEMS } from '../app/(seller)/seller/nav-items';
import { loginPathWithRedirect } from '../hooks/useRequireAuth';
import { isMyNavActive, myNavItems } from '../app/(main)/my/nav-items';

/** 05(구매자 흐름)에서 화면 분기를 정하는 순수 함수들 — 화면 없이 규칙만 고정한다. */

describe('hasRole — roles 가 두 모양으로 온다', () => {
  it('문자열 배열(shared 타입의 모양)', () => {
    expect(hasRole({ roles: ['buyer', 'seller'] }, 'seller')).toBe(true);
    expect(hasRole({ roles: ['buyer'] }, 'seller')).toBe(false);
  });

  it('객체 배열(`/auth/me` 의 실제 모양)', () => {
    expect(hasRole({ roles: [{ name: 'admin' }] }, 'admin')).toBe(true);
    expect(hasRole({ roles: [{ name: 'admin' }] }, 'buyer')).toBe(false);
  });

  it('사용자가 없거나 roles 가 배열이 아니면 false(죽지 않는다)', () => {
    expect(hasRole(null, 'buyer')).toBe(false);
    expect(hasRole(undefined, 'buyer')).toBe(false);
    expect(hasRole({}, 'buyer')).toBe(false);
    expect(hasRole({ roles: 'buyer' }, 'buyer')).toBe(false);
    expect(hasRole({ roles: [null, { name: 'buyer' }] }, 'buyer')).toBe(true);
  });
});

describe('applyWishToggle — 찜 id 캐시를 뒤집는다', () => {
  it('추가: 맨 앞에 넣는다(최근 찜한 순)', () => {
    expect(applyWishToggle([3, 5], 7, true)).toEqual([7, 3, 5]);
  });

  it('제거', () => {
    expect(applyWishToggle([3, 5, 7], 5, false)).toEqual([3, 7]);
  });

  it('이미 있는 것을 다시 추가해도 중복되지 않는다 · 없는 것을 빼도 그대로', () => {
    expect(applyWishToggle([3, 5], 5, true)).toEqual([5, 3]);
    expect(applyWishToggle([3, 5], 9, false)).toEqual([3, 5]);
  });

  it('원본 배열을 바꾸지 않는다(롤백에 쓰는 이전 값이 살아 있어야 한다)', () => {
    const previous = [3, 5];
    applyWishToggle(previous, 7, true);
    expect(previous).toEqual([3, 5]);
  });
});

describe('wishlistImageUrl — 위시리스트 카드의 대표 사진', () => {
  const product = (images?: Array<{ url: string; isPrimary: boolean; sortOrder: number }>) =>
    ({ id: 1, name: '상품', price: 1000, status: 'published', brand: 'b', rating: 0, images }) as WishlistItem['product'];

  it('대표로 지정된 사진을 고른다 — 셀러가 올린 사진(/uploads)이든 외부 링크든 같다', () => {
    expect(
      wishlistImageUrl(
        product([
          { url: 'https://example.com/a.jpg', isPrimary: false, sortOrder: 0 },
          { url: '/uploads/b.png', isPrimary: true, sortOrder: 1 },
        ]),
      ),
    ).toBe('/uploads/b.png');
  });

  it('대표가 없으면 순서가 가장 앞선 사진', () => {
    expect(
      wishlistImageUrl(
        product([
          { url: 'https://example.com/second.jpg', isPrimary: false, sortOrder: 2 },
          { url: 'https://example.com/first.jpg', isPrimary: false, sortOrder: 1 },
        ]),
      ),
    ).toBe('https://example.com/first.jpg');
  });

  it('사진이 없거나 옛 응답(images 없음)·상품 없음이면 null — 카드가 회색 칸을 그린다', () => {
    expect(wishlistImageUrl(product([]))).toBeNull();
    expect(wishlistImageUrl(product(undefined))).toBeNull();
    expect(wishlistImageUrl(null)).toBeNull();
  });
});

describe('activeNavHref — 콘솔 사이드바의 현재 메뉴 하나(셀러 센터 메뉴로 확인)', () => {
  it.each([
    ['/seller/products', '/seller/products'],
    ['/seller/products/12/edit', '/seller/products'],
    // "상품 관리"와 앞부분이 겹치지만 더 길게 맞는 "상품 등록" 하나만 고른다
    ['/seller/products/new', '/seller/products/new'],
    ['/seller/orders', '/seller/orders'],
    ['/seller/settlements', '/seller/settlements'],
    ['/seller/inquiries', '/seller/inquiries'],
  ])('%s → %s', (pathname, expected) => {
    expect(activeNavHref(SELLER_NAV_ITEMS, pathname)).toBe(expected);
  });

  it('메뉴에 없는 주소면 아무것도 켜지 않는다', () => {
    expect(activeNavHref(SELLER_NAV_ITEMS, '/seller')).toBeNull();
    expect(activeNavHref(SELLER_NAV_ITEMS, '/seller/productsX')).toBeNull();
  });
});

describe('loginPathWithRedirect', () => {
  it('돌아올 경로(쿼리 포함)를 인코딩해 싣는다', () => {
    expect(loginPathWithRedirect('/my/orders')).toBe('/login?redirect=%2Fmy%2Forders');
    expect(loginPathWithRedirect('/checkout/complete?orderNumber=A-1')).toBe(
      '/login?redirect=%2Fcheckout%2Fcomplete%3ForderNumber%3DA-1',
    );
  });
});

describe('myNavItems — 마이페이지 네비', () => {
  it('구매자: 7개, 셀러 센터는 없다', () => {
    const labels = myNavItems(false).map((i) => i.label);
    expect(labels).toHaveLength(7);
    expect(labels).not.toContain('셀러 센터');
  });

  it('셀러: 맨 끝에 "셀러 센터"(상품 관리로) — "셀러 신청"도 남는다(신청 내역 확인용)', () => {
    const items = myNavItems(true);
    expect(items).toHaveLength(8);
    expect(items[7]).toMatchObject({ href: '/seller/products', label: '셀러 센터', external: true });
    expect(items.map((i) => i.label)).toContain('셀러 신청');
  });

  it('셀러용 목록을 만들어도 기본 목록은 변하지 않는다', () => {
    myNavItems(true);
    expect(myNavItems(false)).toHaveLength(7);
  });

  it('"내 정보"는 /my 에서만, 나머지는 하위 주소에서도 켜진다', () => {
    const [info, orders] = myNavItems(false);
    expect(isMyNavActive('/my', info)).toBe(true);
    expect(isMyNavActive('/my/orders', info)).toBe(false);
    expect(isMyNavActive('/my/orders/A-1', orders)).toBe(true);
  });
});
