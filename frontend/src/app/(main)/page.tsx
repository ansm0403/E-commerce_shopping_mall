import Banner from '@/components/banner/Banner';
import CategoryCollections from '@/components/home/CategoryCollections';
import ProductSection from '@/components/home/ProductSection';
import CategoryTabSection from '@/components/home/CategoryTabSection';
import Link from 'next/link';

export default function Index() {
  return (
    <div className="mystic-home">
        <Banner />

        <div className="mystic-chapter"><span>01 / THE OBJECT ROOM</span><p>익숙한 일상 밖에서,<br />취향을 발견하는 시간.</p></div>
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

        <div className="mystic-worlds"><div className="mystic-chapter"><span>02 / SIX WORLDS</span><p>어떤 세계에<br />머물고 싶나요?</p></div><CategoryCollections /></div>

        <div className="magazine-manifesto mt-14 flex flex-col justify-between gap-6 p-7 text-white sm:mt-20 sm:flex-row sm:items-center sm:p-10">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em]">BETWEEN THE ORDINARY & THE UNKNOWN</p>
            <h2 className="mt-3 text-2xl font-medium tracking-tight sm:text-3xl">낯선 발견이,<br />나의 일상이 되는 곳.</h2>
            <p className="mt-3 text-sm leading-relaxed">마음이 향하는 물건을 따라, 다음 장면으로.</p>
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

    </div>
  );
}
