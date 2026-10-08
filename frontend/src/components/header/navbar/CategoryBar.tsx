'use client'

import React from 'react';
import Link from 'next/link';
import { useCategories } from '@/hooks/useCategories';

const SKELETON_COUNT = 6;

function NavItem({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className="relative inline-block px-3 py-3 text-xs sm:text-sm font-medium text-primary-500 whitespace-nowrap transition-colors hover:text-primary-600 group"
    >
      {children}
      <span aria-hidden="true" className="absolute bottom-0 left-0 w-0 h-0.5 bg-primary-600 transition-all duration-200 group-hover:w-full rounded-full" />
    </Link>
  );
}

export default function CategoryBar() {
  const { roots, isLoading, isError } = useCategories();

  return (
    <nav aria-label="주요 카테고리" className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto">
      <NavItem href="/products">전체</NavItem>

      {isLoading && Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <div key={i} className="h-3 w-14 bg-gray-200 rounded animate-pulse mx-3" />
      ))}

      {!isLoading && !isError && roots.map((category) => (
        <NavItem
          key={category.id}
          href={`/products?categoryId=${category.id}`}
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
