'use client'

import React from 'react';
import { useRouter } from 'next/navigation';
import { useCategories } from '@/hooks/useCategories';

const SKELETON_COUNT = 6;

function NavItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative px-3 py-3 text-sm font-medium text-gray-600 whitespace-nowrap transition-colors hover:text-indigo-600 group"
    >
      {children}
      <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-indigo-600 transition-all duration-200 group-hover:w-full rounded-full" />
    </button>
  );
}

export default function CategoryBar() {
  const router = useRouter();
  const { roots, isLoading, isError } = useCategories();

  return (
    <nav className="flex items-center overflow-x-auto">
      <NavItem onClick={() => router.push('/')}>HOME</NavItem>

      {isLoading && Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <div key={i} className="h-3 w-14 bg-gray-200 rounded animate-pulse mx-3" />
      ))}

      {!isLoading && !isError && roots.map((category) => (
        <NavItem
          key={category.id}
          onClick={() => router.push(`/products?categoryId=${category.id}`)}
        >
          {category.name}
        </NavItem>
      ))}

      {isError && (
        <span className="px-4 py-3 text-xs text-red-500">카테고리를 불러올 수 없습니다.</span>
      )}
    </nav>
  );
}
