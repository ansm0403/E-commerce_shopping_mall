'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '../../../../service/auth';
import { ROLE_CHECK_QUERY_KEY } from '../../../../contexts/AuthContext';

/**
 * /auth/me의 실제 백엔드 응답 형태.
 * - shared의 UserProfileResponse는 roles를 string[] 으로 정의하지만,
 *   실제 응답은 UserProfileResponseDto(RoleDto[])라 [{ name: 'admin' }] 형태.
 * - 타입 미스매치를 우회하기 위해 가드가 필요한 최소 필드만 정의.
 */
interface MeResponse {
  roles?: { name: string }[];
}

/**
 * (admin) 영역의 클라이언트 사이드 인증/인가 가드.
 *
 * 동작:
 *   1. /auth/me 호출 (axios authClient — accessToken 자동 첨부, 401 시 자동 refresh)
 *   2. 응답 user.roles 안에 'admin'이 있으면 children 렌더
 *   3. 401/네트워크 에러: axios 인터셉터가 이미 /login으로 보냈을 가능성 → 추가 redirect는
 *      한 번만 (race condition 방지)
 *   4. 비-admin: 홈으로 replace
 *
 * 왜 Server Component가 아닌 Client에서 검증하는가:
 *   - Server Component는 cookies().set() 불가 → /auth/refresh가 회전된 새 토큰을 내려도
 *     브라우저에 반영 못함. 다음 호출이 "토큰 재사용"으로 오판되어 모든 세션 invalidate.
 *   - Client에서 axios로 호출하면 응답 Set-Cookie를 브라우저가 자동 처리 → 회전 부작용 없음.
 */
export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const { data, isLoading, isError } = useQuery<MeResponse>({
    queryKey: ROLE_CHECK_QUERY_KEY,
    queryFn: async () => (await getMe()).data as unknown as MeResponse,
    staleTime: 60 * 1000,           // 1분 동안은 재조회 안 함
    refetchOnWindowFocus: false,    // admin 화면에서 탭 포커스마다 me 호출은 과함
    retry: false,                   // axios 인터셉터가 401 시 이미 refresh 재시도 처리
  });

  // 비-admin 사용자는 홈으로 (useEffect 안에서 router.replace — 렌더 중 navigate 금지)
  const isAdmin = !!data?.roles?.some((r) => r.name === 'admin');

  useEffect(() => {
    if (data && !isAdmin) {
      router.replace('/');
    }
  }, [data, isAdmin, router]);

  // 1) 로딩
  if (isLoading) {
    return (
      <div style={statusStyle}>
        <span style={spinnerDotStyle} />
        인증 확인 중...
      </div>
    );
  }

  // 2) 에러 (axios 인터셉터가 이미 /login 처리 중일 수 있음)
  //    이 화면은 그 사이의 한 프레임만 노출됨.
  if (isError || !data) {
    return (
      <div style={statusStyle}>
        세션이 만료되었습니다. <a
          href={`/login?redirect=${encodeURIComponent(pathname)}`}
          style={linkStyle}
        >
          다시 로그인
        </a>
      </div>
    );
  }

  // 3) 비-admin
  if (!isAdmin) {
    return (
      <div style={statusStyle}>
        관리자 권한이 필요합니다.
      </div>
    );
  }

  // 4) admin → 자식 렌더
  return <>{children}</>;
}

// ─────────────────── 스타일 ───────────────────

const statusStyle: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  gap:            '8px',
  minHeight:      '60vh',
  fontSize:       '14px',
  color:          '#475569',
};

const spinnerDotStyle: React.CSSProperties = {
  display:      'inline-block',
  width:        '8px',
  height:       '8px',
  borderRadius: '50%',
  background:   '#94a3b8',
};

const linkStyle: React.CSSProperties = {
  color:          '#2563eb',
  textDecoration: 'underline',
  marginLeft:     '4px',
};
