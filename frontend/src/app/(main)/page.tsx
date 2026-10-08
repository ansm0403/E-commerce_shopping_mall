import Banner from '@/components/banner/Banner';
import CategoryCollections from '@/components/home/CategoryCollections';
import ProductSection from '@/components/home/ProductSection';
import CategoryTabSection from '@/components/home/CategoryTabSection';
import Link from 'next/link';

export default function Index() {
  return (
    <>
        <Banner />
        <CategoryCollections />

        {/* 인기 상품 */}
        <ProductSection
          title="지금 많이 찾는 상품"
          description="높은 별점을 받은 상품부터 만나보세요"
          href="/products?sortBy=rating&sortOrder=DESC&rated=true"
          sortBy="rating"
          filter={{ rating: { gt: 0 } }}
          sortOrder="DESC"
          count={8}
        />

        <div className="mt-14 flex flex-col justify-between gap-6 rounded-3xl bg-[#20291f] p-7 text-white sm:mt-20 sm:flex-row sm:items-center sm:p-10">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-[#c4d3b6]">A SPACE FOR YOUR TASTE</p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight sm:text-3xl">좋아하는 것들로 채우는 일상.</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#c4d3b6]">카테고리마다 다른 취향, 그 안에서 나만의 발견.</p>
          </div>
          <Link href="/products" className="inline-flex h-12 shrink-0 items-center justify-between gap-8 self-start rounded-full bg-[#e9eee4] px-6 text-sm font-semibold text-[#20291f] transition-colors hover:bg-white sm:self-auto">취향 탐색하기 <span aria-hidden="true">↗</span></Link>
        </div>

        <CategoryTabSection />

        {/* 신상품 */}
        <ProductSection
          title="신상품"
          description="가장 최근에 만나게 된 새로운 아이템"
          href="/products?sortBy=createdAt&sortOrder=DESC"
          sortBy="createdAt"
          sortOrder="DESC"
          count={8}
        />

    </>
  );
}
