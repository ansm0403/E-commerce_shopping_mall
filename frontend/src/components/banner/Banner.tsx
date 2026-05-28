'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import BannerSection from './BannerSection';

interface BannerContentProps {
  bannerImg: string;
  children?: React.ReactNode;
  className?: string;
  priority?: boolean;
  sizes?: string;
}

function BannerContent({ bannerImg, children, className = '', priority = false, sizes }: BannerContentProps) {
  return (
    <div className="relative flex-shrink-0 w-full h-full flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
      {bannerImg && (
        <Image
          src={bannerImg}
          alt=""
          aria-hidden
          fill
          priority={priority}
          sizes={sizes ?? '100vw'}
          className={`object-cover ${className}`}
        />
      )}
      {children}
    </div>
  );
}

export default function Banner() {
  const mainBanners = [
    "/images/banner/main_banner1.webp",
    "/images/banner/main_banner2.webp",
    "/images/banner/main_banner3.webp",
  ];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const moveTo = useCallback((index: number) => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setCurrentIndex(index);
    setTimeout(() => setIsTransitioning(false), 500); // transition duration과 동일
  }, [isTransitioning]);

  const goToNext = useCallback(() => {
    moveTo((currentIndex + 1) % mainBanners.length);
  }, [currentIndex, mainBanners.length, moveTo]);

  const goToPrev = useCallback(() => {
    moveTo((currentIndex - 1 + mainBanners.length) % mainBanners.length);
  }, [currentIndex, mainBanners.length, moveTo]);

  const goToIndex = (index: number) => {
    moveTo(index);
  };

  // 자동재생: hover 및 탭 비활성화 시 일시정지
  useEffect(() => {
    if (isHovered) return;

    const handleVisibilityChange = () => {
      // visibilitychange는 상태만 추적, interval은 아래에서 관리
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      goToNext();
    }, 3000);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isHovered, goToNext]);

  return (
    <BannerSection
      backgroundColor="#f8f9fa"
      backgroundImage="/images/banner/bannerbackground.webp"
    >
      <div className="grid grid-cols-[2fr_1fr] grid-rows-[1fr_1.5fr] gap-4 py-8 min-h-[500px]">
        {/* 메인 배너 캐러셀 */}
        {/* fallback gradient: 이미지 로드 실패 시 표시 */}
        <div
          className="col-start-1 row-span-2 rounded-lg overflow-hidden relative bg-[linear-gradient(135deg,#d2f9a0_0%,#dffd5b_100%)] cursor-pointer group"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* 슬라이드 트랙: hover 시 이미지 전체가 서서히 zoom-in */}
          <div
            className="flex h-full transition-transform duration-500 ease-in-out"
            style={{ transform: `translateX(-${currentIndex * 100}%)` }}
          >
            {mainBanners.map((mainBanner, index) => (
              // hover 시 scale-105로 zoom-in, duration-700으로 느리고 부드럽게
              <BannerContent
                bannerImg={mainBanner}
                key={mainBanner}
                priority={index === 0}
                sizes="(max-width: 768px) 100vw, 800px"
                className="transition-transform duration-700 ease-in-out group-hover:scale-105"
              />
            ))}
          </div>

          {/*
            오버레이: hover 시 배경이 서서히 어두워짐
            - opacity-0 → group-hover:opacity-40 (500ms 페이드인)
            - pointer-events-none: 오버레이가 버튼 클릭을 막지 않도록
          */}
          <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-40 transition-opacity duration-500 pointer-events-none z-10" />

          {/*
            CTA 텍스트: hover 시 아래에서 위로 슬라이드업 + 페이드인
            - translate-y-4 → group-hover:translate-y-0: 아래에서 올라오는 효과
            - opacity-0 → group-hover:opacity-100: 동시에 나타남
            - delay-75: 오버레이보다 살짝 늦게 시작해 순서감 부여
          */}
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-500 delay-75 pointer-events-none">
            <span className="text-white text-lg font-semibold tracking-wide drop-shadow-lg">지금 쇼핑하기</span>
            <span className="text-white/80 text-sm">→</span>
          </div>

          {/* 이전 버튼 */}
          <button
            onClick={goToPrev}
            disabled={isTransitioning}
            className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-0 text-white w-9 h-9 rounded-full flex items-center justify-center transition-colors z-30"
            aria-label="이전 슬라이드"
          >
            ‹
          </button>

          {/* 다음 버튼 */}
          <button
            onClick={goToNext}
            disabled={isTransitioning}
            className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 disabled:opacity-0 text-white w-9 h-9 rounded-full flex items-center justify-center transition-colors z-30"
            aria-label="다음 슬라이드"
          >
            ›
          </button>

          {/* Dot indicator */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-30">
            {mainBanners.map((_, index) => (
              <button
                key={index}
                onClick={() => goToIndex(index)}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  index === currentIndex ? 'bg-white' : 'bg-white/40'
                }`}
                aria-label={`슬라이드 ${index + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="col-start-2 row-start-1 bg-[linear-gradient(135deg,#f093fb_0%,#f5576c_100%)] cursor-pointer rounded-lg overflow-hidden group">
          <BannerContent bannerImg="/images/banner/sub_banner1.webp" sizes="(max-width: 768px) 100vw, 400px" className="transition-transform duration-500 ease-in-out group-hover:scale-110" />
        </div>

        <div className="col-start-2 row-start-2 bg-[linear-gradient(135deg,#4facfe_0%,#00f2fe_100%)] cursor-pointer rounded-lg overflow-hidden group">
          <BannerContent bannerImg="/images/banner/sub_banner2.webp" sizes="(max-width: 768px) 100vw, 400px" className="transition-transform duration-500 ease-in-out group-hover:scale-110" />
        </div>
      </div>
    </BannerSection>
  );
}
