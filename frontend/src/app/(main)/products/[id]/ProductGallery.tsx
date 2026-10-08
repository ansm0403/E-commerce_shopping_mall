'use client';

import { useState } from 'react';
import { ProductImage } from '@/model/product';
import ProductPhoto from '@/components/home/ProductPhoto';

interface ProductGalleryProps {
  images: ProductImage[];
}

export default function ProductGallery({ images }: ProductGalleryProps) {
  const sortedImages = (Array.isArray(images) ? [...images] : []).sort((a, b) => {
    if (a.isPrimary) return -1;
    if (b.isPrimary) return 1;
    return a.sortOrder - b.sortOrder;
  });

  const displayImages = sortedImages.length > 0 ? sortedImages : [
    { id: 0, url: '/images/placeholder.svg', isPrimary: true, sortOrder: 0 }
  ];

  const [mainImageIndex, setMainImageIndex] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomPosition, setZoomPosition] = useState({ x: 0, y: 0 });

  const mainImage = displayImages[mainImageIndex];

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isZoomed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setZoomPosition({ x, y });
  };

  return (
    <div className="space-y-3 md:space-y-4">
      {/* 메인 이미지 */}
      <div
        className="relative w-full aspect-square bg-[#f3f3ef] rounded-3xl overflow-hidden group cursor-zoom-in transition-all"
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsZoomed(true)}
        onMouseLeave={() => setIsZoomed(false)}
      >
        <ProductPhoto
          src={mainImage.url}
          alt="상품 이미지"
          eager
          className={`absolute inset-0 w-full h-full object-contain p-6 sm:p-10 mix-blend-multiply transition-transform duration-300 ${
            isZoomed ? 'scale-150' : 'scale-100'
          }`}
          style={
            isZoomed
              ? { transformOrigin: `${zoomPosition.x}% ${zoomPosition.y}%` }
              : undefined
          }
        />

        {/* 줌 인디케이터 */}
        {displayImages.length > 1 && (
          <div className="absolute top-4 right-4 bg-black/60 text-white text-xs px-3 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
            🔍 마우스 호버로 확대
          </div>
        )}

        {/* 이미지 카운터 */}
        <div className="absolute bottom-4 right-4 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
          {mainImageIndex + 1} / {displayImages.length}
        </div>
      </div>

      {/* 썸네일 캐러셀 */}
      {displayImages.length > 1 && (
        <div className="grid grid-cols-4 gap-2">
          {displayImages.map((img, idx) => (
            <button
              key={img.id}
              onClick={() => setMainImageIndex(idx)}
              className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                idx === mainImageIndex
                  ? 'border-primary-600'
                  : 'border-secondary-200 hover:border-secondary-300'
              }`}
            >
              <ProductPhoto
                src={img.url}
                alt={`상품 이미지 ${idx + 1}`}
                className="absolute inset-0 w-full h-full object-contain p-2"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
