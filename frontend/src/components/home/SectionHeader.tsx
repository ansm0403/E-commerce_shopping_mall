import Link from 'next/link';

interface SectionHeaderProps {
  title: string;
  /** "더보기" 링크 경로 (없으면 버튼 미표시) */
  href?: string;
  /** 부제목 또는 설명 */
  description?: string;
}

export default function SectionHeader({ title, href, description }: SectionHeaderProps) {
  return (
    <div className="magazine-section-heading mb-6 flex items-end justify-between gap-4 sm:mb-8">
      <div>
        <h2 className="text-xl font-semibold tracking-[-0.035em] text-primary-600 sm:text-[28px]">{title}</h2>
        {description && (
          <p className="mt-2 text-xs leading-relaxed text-primary-400 sm:text-sm">{description}</p>
        )}
      </div>
      {href && (
        <Link
          href={href}
          className="flex shrink-0 items-center gap-2 rounded-full border border-primary-100 px-3 py-2 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-50 sm:px-4 sm:text-sm"
        >
          전체 보기
          <span aria-hidden="true">↗</span>
        </Link>
      )}
    </div>
  );
}
