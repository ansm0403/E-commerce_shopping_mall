import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getShoppingEvent, shoppingEvents } from '@/lib/events';
import EventContent from '../EventContent';

export const dynamicParams = false;
export const generateStaticParams = () => shoppingEvents.map((event) => ({ slug: event.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const event = getShoppingEvent((await params).slug);
  return event ? { title: event.title, description: event.description } : { title: '기획전을 찾을 수 없습니다' };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const event = getShoppingEvent((await params).slug);
  if (!event) notFound();
  return <EventContent event={event} />;
}
