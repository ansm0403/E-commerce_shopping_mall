'use client';

import { Product } from '@/model/product';
import dynamic from 'next/dynamic';
import ReviewSection from './ReviewSection';
import Link from 'next/link';
import { specLabel, specValue } from '@/lib/product-specs';

// 문의 탭은 폼 라이브러리(react-hook-form + zod)를 끌고 온다 — 상품 상세의 첫 화면에는 필요 없으므로
// 탭을 열 때 따로 받는다(정적 import 면 상품 상세 First Load 가 그만큼 커진다).
const InquirySection = dynamic(() => import('./InquirySection'), {
  loading: () => <div className="text-center py-12 text-secondary-500">문의를 불러오는 중...</div>,
});

interface ProductTabsProps {
  product: Product;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function ProductTabs({
  product,
  activeTab,
  onTabChange,
}: ProductTabsProps) {
  const tabs = [
    { id: 'description', label: '상세 설명' },
    { id: 'specs', label: '상품 스펙' },
    { id: 'review', label: product.reviewCount != null ? `리뷰 (${product.reviewCount})` : '리뷰' },
    { id: 'inquiry', label: '문의' },
    { id: 'seller', label: '판매자 정보' },
    { id: 'shipping', label: '배송 정보' },
  ];

  return (
    <div className="rounded-3xl border border-primary-100 bg-white p-5 sm:p-8">
      {/* 탭 헤더 */}
      <div className="no-scrollbar flex border-b border-secondary-200 mb-8 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            aria-pressed={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-4 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-secondary-600 hover:text-secondary-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div>
        {/* 상세 설명 */}
        {activeTab === 'description' && (
          <div className="prose prose-sm max-w-none">
            <div className="space-y-4">
              {product.description ? (
                <div
                  className="text-secondary-700 leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: product.description }}
                />
              ) : (
                <p className="text-secondary-500 italic">상세 설명이 없습니다.</p>
              )}
            </div>
          </div>
        )}

        {/* 상품 스펙 */}
        {activeTab === 'specs' && (
          <div className="space-y-4">
            {product.specs && Object.keys(product.specs).length > 0 ? (
              <dl className="space-y-3">
                {Object.entries(product.specs).map(([key, value]) => (
                  <div
                    key={key}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 border-b border-secondary-100 pb-3"
                  >
                    <dt className="font-semibold text-secondary-700">{specLabel(key)}</dt>
                    <dd className="min-w-0 break-words text-secondary-600 text-right">{specValue(key, value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-secondary-500 italic">스펙 정보가 없습니다.</p>
            )}
          </div>
        )}

        {/* 리뷰 */}
        {activeTab === 'review' && <ReviewSection product={product} />}

        {/* 문의 */}
        {activeTab === 'inquiry' && <InquirySection product={product} />}

        {/* 판매자 정보 */}
        {activeTab === 'seller' && (
          <div className="space-y-4">
            {product.seller ? (
              <div className="bg-secondary-50 rounded-lg p-6 space-y-4">
                <div>
                  <p className="text-sm text-secondary-500 mb-1">사업명</p>
                  <p className="text-lg font-semibold text-secondary-900">
                    {product.seller.businessName}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-secondary-500 mb-1">대표자명</p>
                  <p className="text-secondary-700">{product.seller.representativeName}</p>
                </div>
                <div>
                  <p className="text-sm text-secondary-500 mb-1">상태</p>
                  <span className="inline-block px-3 py-1 bg-green-100 text-green-700 text-sm font-semibold rounded-full">
                    {product.seller.status === 'approved' ? '승인된 판매자' : '판매자'}
                  </span>
                </div>
                <Link href={`/products?sellerId=${product.seller.id}`} className="inline-flex text-sm font-semibold text-primary-600 underline underline-offset-4">판매자의 다른 상품 보기 →</Link>
              </div>
            ) : (
              <p className="text-secondary-500 italic">판매자 정보가 없습니다.</p>
            )}
          </div>
        )}

        {/* 배송 정보 */}
        {activeTab === 'shipping' && (
          <div className="bg-secondary-50 rounded-lg p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-secondary-500 mb-1">배송 방법</p>
                <p className="text-secondary-900 font-semibold">택배</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 mb-1">배송비</p>
                <p className="text-secondary-900 font-semibold">
                  {product.price >= 50000 ? '무료' : '3,000원'}
                </p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 mb-1">배송 기간</p>
                <p className="text-secondary-900 font-semibold">2-3일 이내</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 mb-1">교환/반품</p>
                <p className="text-secondary-900 font-semibold">가능 (7일 이내)</p>
              </div>
            </div>
            <div className="border-t pt-4">
              <p className="text-sm text-secondary-600">
                ℹ️ 상세한 배송 및 반품 정책은 판매자에게 문의해주세요.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
