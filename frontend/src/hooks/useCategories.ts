'use client'

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { categoryQueryOptions } from '@/lib/react-query/category-query-options';
import type { CategoryTreeNode } from '@/service/category';

const EMPTY: CategoryTreeNode[] = [];

function flattenTree(nodes: CategoryTreeNode[], result: CategoryTreeNode[] = []): CategoryTreeNode[] {
  // 배열이 아닌 응답(객체·문자열)은 빈 목록으로 — Sentry 7747401267 "t is not iterable"(홈 전체 흰 화면).
  // `data: tree = []` 기본값은 undefined 만 막아 객체는 그대로 들어왔다(Ops Companion 분석 #55 가 짚은 줄).
  if (!Array.isArray(nodes)) return result;
  for (const node of nodes) {
    result.push(node);
    if (Array.isArray(node?.children) && node.children.length > 0) {
      flattenTree(node.children, result);
    }
  }
  return result;
}

export function useCategories() {
  const { data, isLoading, isError } = useQuery(categoryQueryOptions.tree());
  // 응답 모양 검증은 여기 한 곳에서 — roots 도 flat 도 배열만 받는다(같은 EMPTY 참조라 useMemo 가 헛돌지 않는다)
  const tree = Array.isArray(data) ? data : EMPTY;

  // tree()는 이미 최상위(roots)만 반환하므로 그대로 roots로 사용
  const roots = tree;

  // flat 목록 — CategorySelect용
  const flat = useMemo(() => flattenTree(tree), [tree]);

  return { tree, roots, flat, isLoading, isError };
}
