'use client';
import Link from 'next/link';
import { useAuth } from '../../../../../contexts/AuthContext';

export default function ProductCreateLink() {
  const { user, isLoading } = useAuth();
  if (isLoading || user?.isDemo)
    return (
      <span className="text-sm text-slate-500">
        체험 계정은 상품 등록이 제한됩니다
      </span>
    );
  return (
    <Link
      href="/seller/products/new"
      className="text-sm font-semibold px-4 py-2 rounded-lg bg-blue-600 text-white whitespace-nowrap"
    >
      + 상품 등록
    </Link>
  );
}
