export interface ShoppingEvent {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  image: string;
  imageAlt: string;
  color: string;
  accent: string;
  categorySlugs?: string[];
  discountedOnly?: boolean;
  ratedOnly?: boolean;
  note: string;
}

export const shoppingEvents: ShoppingEvent[] = [
  { slug: 'special-finds', title: '좋은 발견, 더 좋은 가격.', eyebrow: 'SPECIAL FINDS', description: '마음에 담아두었던 취향을 조금 더 가볍게. 현재 할인 중인 상품을 한곳에서 만나보세요.', image: '/images/banner/main_banner3.webp', imageAlt: '쇼핑백과 컬러 그래픽을 담은 쇼핑 배너', color: '#edf4f6', accent: '#275469', discountedOnly: true, note: '할인율은 상품마다 다르며, 상품에 표시된 현재 판매가가 적용됩니다.' },
  { slug: 'everyday-favorites', title: '별점으로 만나는 좋은 취향.', eyebrow: 'EVERYDAY FAVORITES', description: '먼저 만나본 사람들의 평가에서 시작하는 쇼핑. 높은 평점을 받은 상품부터 천천히 둘러보세요.', image: '/images/banner/main_banner2.webp', imageAlt: '분홍색 배경의 쇼핑몰 배너', color: '#faedf6', accent: '#82335f', ratedOnly: true, note: '상품의 현재 평균 평점순으로 소개합니다. 리뷰 수와 내용을 함께 확인해주세요.' },
  { slug: 'summer-edit', title: '가볍게 입는 여름의 기분.', eyebrow: 'SUMMER EDIT', description: '햇살 아래 어울리는 색과 편안한 소재. 여름 의류 카테고리에서 다음 옷차림을 골라보세요.', image: '/images/banner/main_banner1.webp', imageAlt: '노란색과 민트색 배경의 여름 쇼핑 배너', color: '#f5f4de', accent: '#596022', categorySlugs: ['clothing-summer'], note: '여름 의류를 모은 상시 기획전입니다. 가격과 재고는 상품 상세에서 확인할 수 있습니다.' },
  { slug: 'gift-edit', title: '선물처럼 만나는 작은 발견.', eyebrow: 'GIFT EDIT', description: '평범한 하루에 작은 즐거움을 더하는 책과 생활용품. 나에게도, 소중한 사람에게도 어울리는 취향을 찾아보세요.', image: '/images/banner/sub_banner1.webp', imageAlt: '선물과 쇼핑백을 담은 블랙 프라이데이 배너', color: '#fcece8', accent: '#9b3c31', categorySlugs: ['book', 'living'], note: '책과 생활용품을 모은 상시 기획전입니다. 별도의 블랙 프라이데이 기간 할인은 적용되지 않습니다.' },
  { slug: 'style-edit', title: '오늘의 스타일, 나답게.', eyebrow: 'STYLE EDIT', description: '옷 한 벌과 신발 한 켤레에서 시작되는 새로운 분위기. 의류와 신발을 함께 살펴보세요.', image: '/images/banner/sub_banner2.webp', imageAlt: '파스텔 색상의 패션 쇼핑 배너', color: '#f4edfb', accent: '#604286', categorySlugs: ['clothing', 'shoes'], note: '현재 판매 중인 의류와 신발을 소개합니다. 할인 혜택은 상품별 표시를 기준으로 확인해주세요.' },
];

export const getShoppingEvent = (slug: string) => shoppingEvents.find((event) => event.slug === slug);
