import { redirect } from 'next/navigation';

/** 실제 장바구니는 `/cart` 다 — 예전 중복 주소(`/my/cart`)로 들어오면 그리로 보낸다. */
export default function MyCartRedirectPage() {
  redirect('/cart');
}
