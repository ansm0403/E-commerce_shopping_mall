'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '../../../../service/auth';
import { useSellerRoleSync } from '../../../../hooks/seller-query-options';

/**
 * /auth/me 실제 응답 형태 — AdminGuard 와 같은 이유로 최소 필드만 정의.
 * (shared 의 UserProfileResponse 는 roles: string[] 이지만 실제로는 RoleDto[])
 */
interface MeResponse {
  roles?: { name: string }[];
}

/**
 * (main)/seller/* 의 클라이언트 사이드 인가 가드 — AdminGuard 를 본떴다.
 *
 * AdminGuard 와 다른 점 두 가지:
 *   1. 비-셀러는 홈이 아니라 /my/seller-apply 로 안내한다 — "셀러가 되는 길"이 있는 화면이라서.
 *   2. 승인 직후 토큰이 낡은 경우(/auth/me 는 seller 인데 토큰엔 buyer 뿐 → 셀러 API 403)를
 *      useSellerRoleSync 로 refresh 1회 자동 해소한다. 관리자는 이런 전이가 없어 불필요했다.
 */
export default function SellerGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const { data, isLoading, isError } = useQuery<MeResponse>({
    queryKey: ['auth', 'me'],
    queryFn: async () => (await getMe()).data as unknown as MeResponse,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const isSeller = !!data?.roles?.some((r) => r.name === 'seller');
  const syncState = useSellerRoleSync(isSeller);

  if (isLoading) {
    return <div style={statusStyle}>인증 확인 중...</div>;
  }

  if (isError || !data) {
    return (
      <div style={statusStyle}>
        세션이 만료되었습니다.
        <Link href={`/login?redirect=${encodeURIComponent(pathname)}`} style={linkStyle}>
          다시 로그인
        </Link>
      </div>
    );
  }

  if (!isSeller) {
    return (
      <div style={{ ...statusStyle, flexDirection: 'column' }}>
        <p style={{ margin: 0 }}>셀러 전용 페이지입니다.</p>
        <Link href="/my/seller-apply" style={linkStyle}>
          셀러 신청하러 가기
        </Link>
      </div>
    );
  }

  // 토큰 갱신 중에는 셀러 API 를 부르면 403 이라 잠시 대기
  if (syncState === 'syncing') {
    return <div style={statusStyle}>셀러 권한 반영 중...</div>;
  }

  if (syncState === 'failed') {
    return (
      <div style={statusStyle}>
        셀러 권한을 불러오지 못했습니다. 다시 로그인해주세요.
        <Link href={`/login?redirect=${encodeURIComponent(pathname)}`} style={linkStyle}>
          다시 로그인
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}

const statusStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  minHeight: '60vh',
  fontSize: '14px',
  color: '#475569',
};

const linkStyle: React.CSSProperties = {
  color: '#2563eb',
  textDecoration: 'underline',
  marginLeft: '4px',
};
