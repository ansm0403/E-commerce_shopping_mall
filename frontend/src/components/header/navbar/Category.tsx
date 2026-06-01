'use client'

import React, { useState, useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { useRouter } from 'next/navigation';
import { gsap } from 'gsap';
import { NavbarButton } from './NavbarButton';
import { useCategories } from '@/hooks/useCategories';
import type { CategoryTreeNode } from '@/service/category';
import CategoryIcon from '@/components/icons/CategoryIcon';


// 드롭다운 아이템 공통 클래스
const ITEM_BASE = 'text-secondary-500 relative py-3 px-4 cursor-pointer bg-white border-l border-r border-b border-secondary-200 hover:bg-secondary-100 hover:text-secondary-900 hover:font-bold';
const ITEM_SHADOW_DEFAULT = 'shadow-[-2px_0_6px_-1px_rgba(0,0,0,0.1),2px_0_6px_-1px_rgba(0,0,0,0.1)]';
const ITEM_SHADOW_FIRST   = 'shadow-[0_-2px_6px_-1px_rgba(0,0,0,0.1),-2px_0_6px_-1px_rgba(0,0,0,0.1),2px_0_6px_-1px_rgba(0,0,0,0.1)]';
const ITEM_SHADOW_LAST    = 'shadow-[-2px_0_6px_-1px_rgba(0,0,0,0.1),2px_0_6px_-1px_rgba(0,0,0,0.1),0_4px_6px_-1px_rgba(0,0,0,0.1)]';

function itemClass(index: number, total: number) {
  const isFirst = index === 0;
  const isLast  = index === total - 1;
  return clsx(
    ITEM_BASE,
    isFirst && 'border-t rounded-t-md ' + ITEM_SHADOW_FIRST,
    isLast  && 'rounded-b-md ' + ITEM_SHADOW_LAST,
    !isFirst && !isLast && ITEM_SHADOW_DEFAULT,
  );
}

// ─── 재귀 카테고리 아이템 ──────────────────────────────────

interface CategoryItemProps {
  category: CategoryTreeNode;
  index: number;
  total: number;
  onSelect: (id: number) => void;
}

const CategoryItem = React.forwardRef<HTMLDivElement, CategoryItemProps>(
  ({ category, index, total, onSelect }, ref) => {
    const [isHovered, setIsHovered] = useState(false);
    const childItemsRef = useRef<(HTMLDivElement | null)[]>([]);

    // 자식 드롭다운 애니메이션 — hover 시 슬라이드인
    useEffect(() => {
      if (isHovered && category.children.length > 0) {
        const targets = childItemsRef.current.filter(Boolean);
        gsap.set(targets, { opacity: 0, x: 30 });
        gsap.to(targets, {
          opacity: 1,
          x: 0,
          duration: 0.4,
          stagger: 0.08,
          ease: 'power2.out',
        });
      }
    }, [isHovered, category.children.length]);

    return (
      <div
        ref={ref}
        className={clsx(itemClass(index, total), 'whitespace-nowrap')}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(category.id);
        }}
      >
        {category.name}

        {/* 자식 카테고리 드롭다운 — 재귀 렌더링 */}
        {isHovered && category.children.length > 0 && (
          <div className="flex flex-col absolute top-0 left-full min-w-[120px] z-dropdown bg-transparent pl-1">
            {category.children.map((child, childIndex) => (
              <CategoryItem
                key={child.id}
                ref={(el) => { childItemsRef.current[childIndex] = el; }}
                category={child}
                index={childIndex}
                total={category.children.length}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
);
CategoryItem.displayName = 'CategoryItem';

// ─── 메인 카테고리 드롭다운 ────────────────────────────────

export default function Category() {
  const [isDropdownVisible, setIsDropdownVisible] = useState(false);
  const categoryItemsRef = useRef<(HTMLDivElement | null)[]>([]);
  const router = useRouter();

  const { tree: categories, isLoading } = useCategories();

  // 메인 카테고리 드롭다운 애니메이션
  useEffect(() => {
    if (isDropdownVisible && categories.length > 0) {
      const targets = categoryItemsRef.current.filter(Boolean);
      gsap.set(targets, { opacity: 0, x: 30 });
      gsap.to(targets, {
        opacity: 1,
        x: 0,
        duration: 0.4,
        stagger: 0.08,
        ease: 'power2.out',
      });
    }
  }, [isDropdownVisible, categories.length]);

  const handleSelect = (id: number) => {
    router.push(`/products?categoryId=${id}`);
  };

  return (
    <div
      className="relative  w-[200px] "
      onMouseEnter={() => setIsDropdownVisible(true)}
      onMouseLeave={() => setIsDropdownVisible(false)}
    >
      <NavbarButton className='bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white w-full flex justify-between items-center rounded-sm transition-colors font-medium text-sm'>
        카테고리
        <CategoryIcon size='md'/>
      </NavbarButton>

      {/* 메인 카테고리 드롭다운 */}
      {isDropdownVisible && (
        <div className="flex flex-col absolute top-full left-0 min-w-full z-dropdown bg-transparent pt-1">
          {isLoading ? (
            <div className={itemClass(0, 1)}>로딩 중...</div>
          ) : (
            categories.map((category, index) => (
              <CategoryItem
                key={category.id}
                ref={(el) => { categoryItemsRef.current[index] = el; }}
                category={category}
                index={index}
                total={categories.length}
                onSelect={handleSelect}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
