import Image from 'next/image';
import Link from 'next/link';
import { shoppingEvents } from '@/lib/events';

export const metadata = { title: '취향을 만나는 기획전', description: '할인 상품, 여름 의류, 패션과 선물까지. SHOPMALL의 기획전을 둘러보세요.' };

export default function EventsPage() {
  return (
    <div className="py-8 sm:py-12">
      <p className="text-xs font-semibold tracking-[0.18em] text-primary-400">CURATED FOR YOU</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">취향을 만나는 기획전.</h1>
      <p className="mt-4 text-sm text-primary-400">다섯 가지 테마에서 다음 일상의 작은 발견을 찾아보세요.</p>
      <div className="magazine-events-grid mt-8">
        {shoppingEvents.map((event) => (
          <Link key={event.slug} href={`/events/${event.slug}`} className="group overflow-hidden rounded-3xl border border-primary-100 bg-white">
            <div className="relative aspect-[16/10] overflow-hidden" style={{ backgroundColor: event.color }}><Image src={event.image} alt={event.imageAlt} fill sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw" className="object-contain transition-transform duration-500 group-hover:scale-[1.035] motion-reduce:transform-none" /></div>
            <div className="p-6"><p className="text-[10px] font-semibold tracking-widest" style={{ color: event.accent }}>{event.eyebrow}</p><h2 className="mt-2 text-xl font-semibold">{event.title}</h2><p className="mt-3 text-sm leading-6 text-primary-400">{event.description}</p><p className="mt-5 text-sm font-semibold">기획전 보기 <span aria-hidden="true">↗</span></p></div>
          </Link>
        ))}
      </div>
    </div>
  );
}
