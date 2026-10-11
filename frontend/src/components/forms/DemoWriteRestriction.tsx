'use client';
import Link from 'next/link';
import { useAuth } from '../../contexts/AuthContext';
export default function DemoWriteRestriction({
  children,
  kind = 'product',
}: {
  children: React.ReactNode;
  kind?: 'product' | 'checkout';
}) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <p>계정을 확인하고 있습니다.</p>;
  if (!user?.isDemo) return <>{children}</>;
  return (
    <div className="my-8 rounded-lg border border-amber-200 bg-amber-50 p-6">
      <p>
        {kind === 'checkout'
          ? '테스트 결제는 구매자 체험에서 이용할 수 있습니다. 다른 역할 체험을 눌러 구매자로 전환해주세요.'
          : '공용 체험 상품을 보호하기 위해 상품 등록·편집을 제한합니다. 상품 목록과 주문·문의 처리를 체험해주세요.'}
      </p>
      <Link
        href={kind === 'checkout' ? '/my/orders' : '/seller/products'}
        className="mt-3 inline-block underline"
      >
        {kind === 'checkout' ? '준비된 주문 보기' : '상품 목록 보기'}
      </Link>
    </div>
  );
}
