import type { ProductImage } from './product';

export interface CartProduct {
  id: number;
  name: string;
  price: number;
  brand: string;
  stockQuantity: number;
  status: string;
  approvalStatus: string;
  isEvent: boolean;
  discountRate: number | null;
  images: ProductImage[];
}

export interface CartItem {
  id: number;
  productId: number;
  quantity: number;
  createdAt: string;
  updatedAt: string;
  product: CartProduct;
}

export interface Cart {
  id: number;
  userId: number;
  createdAt: string;
  updatedAt: string;
  items: CartItem[];
}
