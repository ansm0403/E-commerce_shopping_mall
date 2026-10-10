'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import Link from 'next/link';
import ProductCard, { ProductCardSkeleton } from '@/components/home/ProductCard';
import { shoppingEvents, type ShoppingEvent } from '@/lib/events';
import { getEventCatalog } from '@/service/event-catalog';
import { useCategories } from '@/hooks/useCategories';
import type { CategoryTreeNode } from '@/service/category';

const descendants = (node: CategoryTreeNode): number[] => [node.id, ...node.children.flatMap(descendants)];

export default function EventContent({ event }: { event: ShoppingEvent }) {
  const [sort, setSort] = useState('rating');
  const [visible, setVisible] = useState(12);
  const categories = useCategories();
  const catalog = useQuery({ queryKey: ['events', 'public-catalog'], queryFn: getEventCatalog, staleTime: 60_000 });
  const products = useMemo(() => {
    const ids = event.categorySlugs ? new Set(categories.flat.filter((node) => event.categorySlugs?.includes(node.slug)).flatMap(descendants)) : null;
    return (catalog.data ?? []).filter((product) =>
      (!ids || (product.categoryId != null && ids.has(product.categoryId))) &&
      (!event.discountedOnly || Number(product.discountRate) > 0) &&
      (!event.ratedOnly || Number(product.rating) > 0)
    ).sort((a, b) => {
      if (sort === 'price') return Number(a.price) - Number(b.price) || b.id - a.id;
      if (sort === 'newest') return Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id;
      return Number(b.rating ?? -1) - Number(a.rating ?? -1) || b.id - a.id;
    });
  }, [catalog.data, categories.flat, event, sort]);
  const loading = catalog.isLoading || (!!event.categorySlugs && categories.isLoading);
  const error = catalog.isError || (!!event.categorySlugs && categories.isError);

  return (
    <div className="py-6 sm:py-10">
      <nav aria-label="기획전 위치" className="mb-6 flex flex-wrap gap-2 text-xs text-primary-400"><Link href="/">홈</Link><span aria-hidden="true">/</span><Link href="/events">기획전</Link><span aria-hidden="true">/</span><span>{event.eyebrow}</span></nav>
      <section className="magazine-event-cover grid overflow-hidden lg:grid-cols-[0.8fr_1.2fr]">
        <div className="flex flex-col justify-center p-7 sm:p-10 lg:p-12">
          <p className="text-xs font-semibold tracking-[0.2em]" style={{ color: event.accent }}>{event.eyebrow}</p>
          <h1 className="mt-5 max-w-sm break-keep text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">{event.title}</h1>
          <p className="mt-5 max-w-sm break-keep text-sm leading-7 text-primary-500">{event.description}</p>
          <a href="#event-products" className="mt-7 inline-flex items-center gap-8 self-start rounded-full bg-primary-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700">상품 만나보기 <span aria-hidden="true">↓</span></a>
        </div>
        <div className="relative aspect-[16/10] self-center"><Image src={event.image} alt={event.imageAlt} fill priority sizes="(min-width: 1024px) 650px, 100vw" className="object-contain" /></div>
      </section>

      <section id="event-products" aria-label="기획전 상품" className="scroll-mt-52 pt-10 sm:pt-14">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs tracking-widest text-primary-400">THE COLLECTION</p><h2 className="mt-2 text-2xl font-semibold">이번 기획전의 발견</h2>{!loading && !error && <p className="mt-2 text-sm text-primary-400">{products.length.toLocaleString()}개의 상품</p>}</div>
          <label className="flex items-center gap-3 text-xs text-primary-400">정렬<select aria-label="기획전 상품 정렬" value={sort} onChange={(change) => { setSort(change.target.value); setVisible(12); }} className="rounded-full border border-primary-100 bg-white px-4 py-2.5 text-sm text-primary-600"><option value="rating">평점 높은 순</option><option value="price">낮은 가격순</option><option value="newest">최신순</option></select></label>
        </div>
        {error ? <div role="alert" className="rounded-2xl border border-primary-100 bg-white p-8 text-center"><p className="text-sm text-primary-400">상품을 불러오지 못했습니다.</p><button type="button" onClick={() => { if (categories.isError) window.location.reload(); else void catalog.refetch(); }} className="mt-4 rounded-full border border-primary-100 px-5 py-2 text-sm">다시 시도</button></div> :
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4">{loading ? Array.from({ length: 8 }, (_, index) => <ProductCardSkeleton key={index} />) : products.length ? products.slice(0, visible).map((product) => <ProductCard key={product.id} product={product} />) : <p className="col-span-full rounded-2xl bg-white p-10 text-center text-sm text-primary-400">현재 이 기획전에 해당하는 상품이 없습니다.</p>}</div>}
        {!loading && !error && visible < products.length && <div className="mt-8 text-center"><button type="button" onClick={() => setVisible((count) => count + 12)} className="rounded-full border border-primary-200 bg-white px-8 py-3 text-sm font-semibold hover:bg-primary-50">상품 더 보기 ({Math.min(visible, products.length)} / {products.length})</button></div>}
      </section>

      <aside className="mt-10 rounded-2xl border border-primary-100 bg-white p-6"><h2 className="text-sm font-semibold">기획전 안내</h2><p className="mt-2 text-sm leading-7 text-primary-400">{event.note}</p><p className="text-xs leading-6 text-primary-400">배너에 표시된 문구와 관계없이 실제 가격·할인율·재고는 각 상품의 현재 정보가 기준입니다.</p></aside>
      <section className="mt-12"><div className="flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">다음 취향도 만나보세요</h2><Link href="/events" className="text-xs underline underline-offset-4">기획전 전체 보기</Link></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{shoppingEvents.filter((other) => other.slug !== event.slug).slice(0, 2).map((other) => <Link key={other.slug} href={`/events/${other.slug}`} className="rounded-2xl p-6 transition-opacity hover:opacity-80" style={{ backgroundColor: other.color }}><p className="text-[10px] font-semibold tracking-widest" style={{ color: other.accent }}>{other.eyebrow}</p><p className="mt-2 font-semibold">{other.title} <span aria-hidden="true">↗</span></p></Link>)}</div></section>
    </div>
  );
}
