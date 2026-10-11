import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { CartResponseDto } from './cart-response.dto';

describe('CartResponseDto', () => {
  it.each(['https://example.com/sprite.png', '/uploads/products/sprite.png'])(
    'preserves product image data when serializing %s',
    (url) => {
      const image = { id: 1, url, isPrimary: true, sortOrder: 0 };
      const cart = plainToInstance(
        CartResponseDto,
        { items: [{ product: { images: [{ ...image, productId: 2 }] } }] },
        { excludeExtraneousValues: true },
      );

      expect(cart.items[0].product.images).toEqual([image]);
    },
  );
});
