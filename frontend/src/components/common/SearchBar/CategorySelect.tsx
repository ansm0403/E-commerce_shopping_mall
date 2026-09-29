'use client'

import React from 'react';
import { useCategories } from '@/hooks/useCategories';

interface CategorySelectProps {
  value: number | null;
  onSelect: (categoryId: number | null) => void;
  className?: string;
  /** 보이는 label 이 없는 자리(헤더 검색창)에서 쓰는 접근 가능한 이름 */
  'aria-label'?: string;
}

export default function CategorySelect({ value, onSelect, className, 'aria-label': ariaLabel }: CategorySelectProps) {
  const { flat: flatCategories, isLoading, isError } = useCategories();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    onSelect(v === '' ? null : parseInt(v, 10));
  };

  // value가 실제로 로딩된 옵션 중에 있을 때만 사용 (없으면 "전체 카테고리"로 fallback)
  // 이유: 로딩 전이나 잘못된 categoryId 시 select value 불일치 경고/UX 혼란 방지
  const selectValue =
    value !== null && flatCategories.some((c) => c.id === value)
      ? value.toString()
      : '';

  return (
    <select
      aria-label={ariaLabel}
      onChange={handleChange}
      disabled={isLoading || isError}
      value={selectValue}
      className={`text-sm ${className || ''}`}
    >
      {isError ? (
        <option value="">카테고리를 불러올 수 없습니다</option>
      ) : (
        <>
          <option value="">전체 카테고리</option>
          {flatCategories.map((cat) => (
            <option key={cat.id} value={cat.id.toString()}>
              {'　'.repeat(cat.depth)}{cat.depth > 0 ? '└ ' : ''}{cat.name}
            </option>
          ))}
        </>
      )}
    </select>
  );
}
