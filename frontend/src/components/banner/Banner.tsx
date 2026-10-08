'use client';
import Image from 'next/image';
import Link from 'next/link';
import BannerCarousel from './BannerCarousel';
import { shoppingEvents } from '@/lib/events';

const sideBanners = shoppingEvents.slice(3);

export default function Banner() {
  return (
    <section aria-label="새로운 취향을 발견하는 쇼핑" className="mt-6 lg:mt-9">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 sm:mb-7">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.18em] text-[#47583d]">EVERYDAY, A LITTLE BETTER</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.045em] text-primary-600 sm:text-3xl lg:text-4xl">일상에 더하는 새로운 취향.</h1>
          <p className="mt-2 text-xs text-primary-400 sm:text-sm">입고, 읽고, 즐기는 순간. 지금 눈길을 끄는 상품을 만나보세요.</p>
        </div>
        <Link href="/products" className="inline-flex items-center gap-4 rounded-full border border-primary-100 bg-white px-5 py-2.5 text-xs font-semibold text-primary-600 transition-colors hover:bg-primary-50 sm:text-sm">상품 둘러보기 <span aria-hidden="true">↗</span></Link>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.85fr_1fr] lg:gap-5">
        <BannerCarousel />
        <div aria-label="추천 쇼핑 배너" className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-1 lg:grid-rows-[0.8fr_1.2fr] lg:gap-5">
          {sideBanners.map((banner) => (
            <Link key={banner.slug} href={`/events/${banner.slug}`} aria-label={banner.title + ' · 기획전 보기'} data-side-banner className="group relative aspect-[3/2] min-w-0 overflow-hidden rounded-2xl border border-black/5 transition-shadow duration-500 hover:shadow-lg lg:aspect-auto" style={{ backgroundColor: banner.slug === 'gift-edit' ? '#f3423b' : '#ffcbe5' }}>
              <Image src={banner.image} alt={banner.imageAlt} fill sizes="(min-width: 1024px) 420px, 45vw" className="object-contain transition-transform duration-700 ease-out group-hover:scale-[1.035] motion-reduce:transform-none" />
              <span aria-hidden="true" className="absolute bottom-3 right-3 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full bg-white/90 text-primary-600 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transform-none">↗</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
