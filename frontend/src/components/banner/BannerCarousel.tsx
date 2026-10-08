'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { gsap } from 'gsap';
import { shoppingEvents } from '@/lib/events';

const banners = shoppingEvents.slice(0, 3);

export default function BannerCarousel() {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (hovered || focused || paused || reducedMotion) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setIndex((current) => (current + 1) % banners.length);
      }
    }, 4500);
    return () => window.clearInterval(timer);
  }, [hovered, focused, paused, reducedMotion]);

  useEffect(() => {
    if (!track.current) return;
    const animation = gsap.to(track.current, {
      xPercent: -index * 100,
      duration: reducedMotion ? 0 : 0.8,
      ease: 'power2.inOut',
      overwrite: true,
    });
    return () => { animation.kill(); };
  }, [index, reducedMotion]);

  useEffect(() => {
    const photos = root.current?.querySelectorAll('[data-banner-image]');
    if (!photos) return;
    const animation = gsap.to(photos, {
      scale: hovered && !reducedMotion ? 1.035 : 1,
      duration: reducedMotion ? 0 : 0.8,
      ease: 'power2.out',
      overwrite: true,
    });
    return () => { animation.kill(); };
  }, [hovered, reducedMotion]);

  const move = (direction: number) => setIndex((current) => (current + direction + banners.length) % banners.length);

  return (
    <div
      ref={root}
      role="region"
      aria-roledescription="carousel"
      aria-label="쇼핑 배너"
      data-current-banner={index + 1}
      className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-primary-100 bg-[#f3f3ef]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          move(event.key === 'ArrowRight' ? 1 : -1);
        }
      }}
    >
      <div className="relative aspect-[16/10] flex-1 overflow-hidden">
        <div ref={track} data-banner-track className="absolute inset-0 flex will-change-transform">
        {banners.map((banner, position) => (
          <Link
            key={banner.slug}
            href={`/events/${banner.slug}`}
            data-banner-slide
            aria-hidden={position !== index}
            tabIndex={position === index ? 0 : -1}
            aria-label={`${banner.title} · 기획전 보기`}
            className={`relative h-full w-full shrink-0 ${position === index ? '' : 'pointer-events-none'}`}
          >
            <Image
              src={banner.image}
              alt={banner.imageAlt}
              fill
              priority={position === 0}
              sizes="(min-width: 1024px) 780px, (min-width: 640px) 90vw, 100vw"
              data-banner-image
              className="object-contain"
            />
          </Link>
        ))}
        </div>
      </div>
      <div className="relative z-20 flex items-center justify-between gap-1 border-t border-primary-100 bg-white px-2 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <span aria-live={paused || focused || reducedMotion ? 'polite' : 'off'} aria-atomic="true" className="min-w-8 text-[10px] tabular-nums text-primary-400 sm:text-xs">
            <span className="font-semibold text-primary-600">{String(index + 1).padStart(2, '0')}</span> / {String(banners.length).padStart(2, '0')}
          </span>
          <div className="flex gap-1">
            {banners.map((banner, position) => (
              <button
                key={banner.slug}
                type="button"
                aria-label={`배너 ${position + 1} 보기`}
                aria-current={position === index ? 'true' : undefined}
                onClick={() => setIndex(position)}
                className="flex h-8 w-3.5 items-center justify-center rounded-full hover:bg-primary-50 sm:w-5"
              >
                <span className={`h-1.5 rounded-full transition-all ${position === index ? 'w-3 bg-primary-600 sm:w-4' : 'w-1.5 bg-primary-200'}`} />
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={() => move(-1)} aria-label="이전 배너" className="h-8 w-8 rounded-full border border-primary-100 text-lg transition-colors hover:bg-primary-50">‹</button>
          <button type="button" onClick={() => setPaused((current) => !current)} disabled={reducedMotion} aria-label={reducedMotion ? '움직임 줄이기로 자동 전환 정지됨' : paused ? '배너 자동 전환 재생' : '배너 자동 전환 멈추기'} className="h-8 w-8 rounded-full border border-primary-100 text-xs transition-colors hover:bg-primary-50 disabled:opacity-40"><span aria-hidden="true">{paused || reducedMotion ? '▶' : '❚❚'}</span></button>
          <button type="button" onClick={() => move(1)} aria-label="다음 배너" className="h-8 w-8 rounded-full border border-primary-100 text-lg transition-colors hover:bg-primary-50">›</button>
        </div>
      </div>
    </div>
  );
}
