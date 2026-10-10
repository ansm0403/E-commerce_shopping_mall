'use client';
import Image from 'next/image';
import Link from 'next/link';
import BannerCarousel from './BannerCarousel';
import { shoppingEvents } from '@/lib/events';

const sideBanners = shoppingEvents.slice(3);

export default function Banner() {
  return (
    <section aria-label="새로운 취향을 발견하는 쇼핑" className="magazine-cover mt-6 lg:mt-9">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 sm:mb-7">
        <div>
          <p className="magazine-kicker">SHOPMALL / CABINET OF CURIOSITIES</p>
          <h1 className="magazine-title">일상과 상상<br />그 사이의 발견.</h1>
          <p className="mt-2 text-xs text-primary-400 sm:text-sm">낯선 장면을 지나, 마음에 남는 물건을 만나는 곳.</p>
        </div>
        <Link href="/products" className="inline-flex items-center gap-4 rounded-full border border-primary-100 bg-white px-5 py-2.5 text-xs font-semibold text-primary-600 transition-colors hover:bg-primary-50 sm:text-sm">상품 둘러보기 <span aria-hidden="true">↗</span></Link>
      </div>
      <div className="magazine-banner-grid">
        <BannerCarousel />
        <div aria-label="추천 쇼핑 배너" className="magazine-side-banners">
          {sideBanners.map((banner) => (
            <Link key={banner.slug} href={`/events/${banner.slug}`} aria-label={banner.title + ' · 기획전 보기'} data-side-banner className="group relative aspect-[3/2] min-w-0 overflow-hidden rounded-2xl border border-black/5 transition-shadow duration-500 hover:shadow-lg lg:aspect-auto" style={{ backgroundColor: banner.slug === 'gift-edit' ? '#f3423b' : '#ffcbe5' }}>
              <Image src={banner.image} alt={banner.imageAlt} fill sizes="(min-width: 1024px) 420px, 45vw" className="object-contain transition-transform duration-700 ease-out group-hover:scale-[1.035] motion-reduce:transform-none" />
              <span aria-hidden="true" className="absolute bottom-3 right-3 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full bg-white/90 text-primary-600 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transform-none">↗</span>
            </Link>
          ))}
        </div>
      </div>
      <div className="mystic-cover-index" aria-hidden="true"><span>ENTER THE UNEXPECTED</span><span>SCROLL TO EXPLORE ↓</span></div>
    </section>
  );
}
