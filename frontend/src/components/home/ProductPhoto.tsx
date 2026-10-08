'use client';

import { useState } from 'react';

/** 외부 상품 사진 실패 시 대체 이미지를 표시한다. src 변경은 새 시도로 취급한다. */
export default function ProductPhoto({
  src,
  alt,
  className = '',
  eager = false,
  style,
}: {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
  style?: React.CSSProperties;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const hasFailed = failedSource === src;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 외부 이미지와 same-origin 업로드를 함께 지원한다.
    <img
      src={hasFailed ? '/images/placeholder.svg' : src}
      alt={hasFailed && alt ? `${alt} (이미지 준비 중)` : alt}
      className={className}
      style={style}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      onError={() => {
        if (!hasFailed) setFailedSource(src);
      }}
    />
  );
}
