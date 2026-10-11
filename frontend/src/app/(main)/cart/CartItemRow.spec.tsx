import { fireEvent, render, screen } from '@testing-library/react';
import CartItemRow from './CartItemRow';
import type { CartItem } from '@/model/cart';

jest.mock('../../../hooks/useCart', () => ({
  useUpdateCartItem: () => ({ mutate: jest.fn(), isPending: false }),
  useRemoveCartItem: () => ({ mutate: jest.fn(), isPending: false }),
}));

const item: CartItem = {
  id: 1, productId: 2, quantity: 1, createdAt: '', updatedAt: '',
  product: {
    id: 2, name: '스프라이트', brand: '코카-콜라', price: 1000,
    stockQuantity: 10, status: 'published', approvalStatus: 'approved',
    isEvent: false, discountRate: null, images: [],
  },
};

describe('CartItemRow thumbnails', () => {
  it.each(['https://example.com/sprite.png', '/uploads/products/sprite.png'])(
    'renders the primary product image for %s',
    (url) => {
      render(<CartItemRow item={{ ...item, product: { ...item.product, images: [
        { id: 1, url: '/other.png', isPrimary: false, sortOrder: 0 },
        { id: 2, url, isPrimary: true, sortOrder: 1 },
      ] } }} />);
      expect(screen.getByRole('img').getAttribute('src')).toBe(url);
      expect(screen.getByRole('img').getAttribute('alt')).toBe('스프라이트');
      fireEvent.error(screen.getByRole('img'));
      expect(screen.getByRole('img').getAttribute('src')).toBe('/images/placeholder.svg');
    },
  );

  it('renders a placeholder when there are no images', () => {
    render(<CartItemRow item={item} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/images/placeholder.svg');
  });
});
