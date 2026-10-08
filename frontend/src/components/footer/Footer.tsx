import Link from 'next/link';
import MaxWidthContainer from '@/components/layout/MaxWidthContainer';

/**
 * 쇼핑몰 푸터 — 흰 바탕에 회색 글자로 가볍게.
 *
 * 예전 푸터는 진한 남색 그라데이션 + 가짜 고객센터·SNS 와 `#` 링크(눌러도 아무 데도 안 감)였다.
 * 지금은 **실제로 열리는 화면만** 잇는다 — 판매자 신청·관리자 체험처럼 로그인 뒤에 숨은 기능의 입구도 여기 둔다.
 */
const SECTIONS = [
  {
    title: '쇼핑',
    links: [
      { label: '전체 상품', href: '/products' },
      { label: '인기 상품', href: '/products?sortBy=viewCount&sortOrder=DESC' },
      { label: '신상품', href: '/products?sortBy=createdAt&sortOrder=DESC' },
    ],
  },
  {
    title: '내 계정',
    links: [
      { label: '마이페이지', href: '/my' },
      { label: '주문 내역', href: '/my/orders' },
      { label: '장바구니', href: '/cart' },
    ],
  },
  {
    title: '판매·운영',
    links: [
      { label: '판매자 신청', href: '/my/seller-apply' },
      { label: '관리자 화면 체험', href: '/login' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="mt-20 border-t border-primary-100 bg-[#efefe8] sm:mt-28">
      <MaxWidthContainer>
        <div className="py-12 flex flex-col md:flex-row gap-10 md:gap-20">
          <div className="md:w-64 shrink-0">
            <p className="font-black text-2xl tracking-tighter text-primary-600">SHOPMALL<span aria-hidden="true" className="text-[#526747]">.</span></p>
            <p className="mt-3 text-sm text-primary-400 leading-relaxed">
              포트폴리오용으로 만든 쇼핑몰입니다.
              <br />
              구매자·판매자·관리자 화면을 모두 둘러볼 수 있어요.
            </p>
          </div>

          <nav aria-label="사이트 링크" className="grid grid-cols-2 sm:grid-cols-3 gap-8 flex-1">
            {SECTIONS.map((section) => (
              <div key={section.title}>
                <h2 className="text-sm font-semibold text-primary-600">{section.title}</h2>
                <ul className="mt-3 space-y-2">
                  {section.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-sm text-primary-400 hover:text-primary-600 transition-colors">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <p className="py-6 border-t border-primary-100 text-xs text-primary-400">© {new Date().getFullYear()} ShoppingMall</p>
      </MaxWidthContainer>
    </footer>
  );
}
