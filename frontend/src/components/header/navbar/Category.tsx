'use client'

import React, { useState, useRef, useEffect, useId } from 'react';
import { clsx } from 'clsx';
import Link from 'next/link';
import { gsap } from 'gsap';
import { NavbarButton } from './NavbarButton';
import { useCategories } from '@/hooks/useCategories';
import type { CategoryTreeNode } from '@/service/category';
import CategoryIcon from '@/components/icons/CategoryIcon';


// 드롭다운 아이템 공통 클래스 — 여백은 안쪽 링크가 갖는다(클릭 영역 = 링크 전체)
const ITEM_BASE = 'text-secondary-500 relative bg-white border-l border-r border-b border-secondary-200 hover:bg-secondary-100 hover:text-secondary-900 hover:font-bold';
const LINK_BASE = 'block py-3 px-4 focus-visible:bg-secondary-100 focus-visible:text-secondary-900 focus-visible:font-bold';
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

/** 포커스가 요소 밖으로 나갔을 때만 true — 안쪽 요소끼리 포커스가 옮겨 다니는 blur 는 무시 */
function focusLeft(e: React.FocusEvent<HTMLElement>) {
  return !e.currentTarget.contains(e.relatedTarget as Node | null);
}

// ─── 재귀 카테고리 아이템 ──────────────────────────────────

interface CategoryItemProps {
  category: CategoryTreeNode;
  index: number;
  total: number;
}

const CategoryItem = React.forwardRef<HTMLLIElement, CategoryItemProps>(
  ({ category, index, total }, ref) => {
    // 하위 목록은 마우스를 올렸을 때 + 키보드 포커스가 이 항목 안에 있을 때 펼친다
    // (예전엔 hover 만 → 키보드로는 "의류 › 봄" 같은 하위 카테고리에 도달할 방법이 없었다)
    const [isHovered, setIsHovered] = useState(false);
    const [hasFocus, setHasFocus] = useState(false);
    const isOpen = isHovered || hasFocus;
    const childItemsRef = useRef<(HTMLLIElement | null)[]>([]);

    // 자식 드롭다운 애니메이션 — 펼칠 때 슬라이드인
    useEffect(() => {
      if (isOpen && category.children.length > 0) {
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
    }, [isOpen, category.children.length]);

    return (
      <li
        ref={ref}
        className={clsx(itemClass(index, total), 'whitespace-nowrap')}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setHasFocus(true)}
        onBlur={(e) => { if (focusLeft(e)) setHasFocus(false); }}
      >
        <Link href={`/products?categoryId=${category.id}`} className={LINK_BASE}>
          {category.name}
          {category.children.length > 0 && (
            <span className="sr-only"> (하위 카테고리 {category.children.length}개)</span>
          )}
        </Link>

        {/* 자식 카테고리 드롭다운 — 재귀 렌더링 */}
        {isOpen && category.children.length > 0 && (
          <ul className="flex flex-col absolute top-0 left-full min-w-[120px] z-dropdown bg-transparent pl-1">
            {category.children.map((child, childIndex) => (
              <CategoryItem
                key={child.id}
                ref={(el) => { childItemsRef.current[childIndex] = el; }}
                category={child}
                index={childIndex}
                total={category.children.length}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }
);
CategoryItem.displayName = 'CategoryItem';

// ─── 메인 카테고리 드롭다운 ────────────────────────────────

export default function Category() {
  const [isDropdownVisible, setIsDropdownVisible] = useState(false);
  const categoryItemsRef = useRef<(HTMLLIElement | null)[]>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

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

  // Esc: 닫고 버튼으로 포커스를 돌려준다(목록 안에서 눌러도 길을 잃지 않게)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && isDropdownVisible) {
      setIsDropdownVisible(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div
      className="relative w-[120px] shrink-0 sm:w-[160px]"
      onMouseEnter={() => setIsDropdownVisible(true)}
      onMouseLeave={() => setIsDropdownVisible(false)}
      onKeyDown={handleKeyDown}
      onBlur={(e) => { if (focusLeft(e)) setIsDropdownVisible(false); }}
    >
      {/* 예전엔 hover 전용이라 Enter 를 눌러도 아무 일이 없었다 → 클릭/Enter/Space 로 여닫는 disclosure 버튼 */}
      <NavbarButton
        ref={buttonRef}
        type="button"
        aria-expanded={isDropdownVisible}
        aria-controls={menuId}
        // 마우스는 hover 로 이미 열려 있으니 클릭은 "열기"만(토글하면 hover 중에 닫혀 버린다).
        // 키보드 Enter/Space 는 detail === 0 → 여닫기 토글
        onClick={(e) => setIsDropdownVisible((v) => (e.detail === 0 ? !v : true))}
        className='my-1 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white w-full flex justify-between items-center rounded-lg transition-colors font-medium text-xs sm:text-sm'
      >
        카테고리
        <CategoryIcon size='md'/>
      </NavbarButton>

      {/* 메인 카테고리 드롭다운 — 링크를 누르면 이동과 함께 닫는다 */}
      {isDropdownVisible && (
        <nav id={menuId} aria-label="전체 카테고리" onClick={() => setIsDropdownVisible(false)}>
          {isLoading ? (
            <div className={clsx(itemClass(0, 1), 'absolute top-full left-0 min-w-full mt-1 py-3 px-4')}>로딩 중...</div>
          ) : (
            <ul className="flex flex-col absolute top-full left-0 min-w-full z-dropdown bg-transparent pt-1">
              {categories.map((category, index) => (
                <CategoryItem
                  key={category.id}
                  ref={(el) => { categoryItemsRef.current[index] = el; }}
                  category={category}
                  index={index}
                  total={categories.length}
                />
              ))}
            </ul>
          )}
        </nav>
      )}
    </div>
  );
}
