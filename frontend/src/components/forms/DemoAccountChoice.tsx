'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DemoRole } from '@shopping-mall/shared';
import { getDemoOptions } from '../../service/auth';
import { useDemoLoginMutation } from '../../hook/useAuthMutation';
import { authRevision, supportsSessionLock } from '../../service/auth-session';
import { authStorage } from '../../service/auth-storage';

const choices: {
  role: DemoRole;
  label: string;
  description: string;
  href: string;
}[] = [
  {
    role: 'buyer',
    label: '구매자 체험',
    description: '장바구니·테스트 결제, 준비된 주문으로 배송·리뷰',
    href: '/my/orders',
  },
  {
    role: 'seller',
    label: '셀러 체험',
    description: '주문·배송 처리와 상품 문의 답변',
    href: '/seller',
  },
  {
    role: 'admin',
    label: '관리자 체험',
    description: '대시보드와 운영 기능',
    href: '/admin/dashboard',
  },
];
export default function DemoAccountChoice({
  busy,
  onStart,
  onError,
}: {
  busy: boolean;
  onStart: () => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const options = useQuery({
    queryKey: ['auth', 'demo-options'],
    queryFn: async () => (await getDemoOptions()).data,
    staleTime: 30000,
    retry: false,
  });
  const login = useDemoLoginMutation();
  const [lockSupported, setLockSupported] = useState(true);
  const [logoutPending, setLogoutPending] = useState(false);
  useEffect(() => {
    setLockSupported(supportsSessionLock());
    setLogoutPending(authStorage.isLogoutPending());
  }, [login.isError]);
  return (
    <div id="demo-choice" className="w-full mt-6 pt-5 border-t border-gray-200">
      <p className="text-sm font-semibold text-center mb-3">
        가입 없이 체험하기
      </p>
      <div className="grid gap-2">
        {choices.map((choice) => (
          <button
            type="button"
            key={choice.role}
            disabled={
              busy || login.isPending || !options.data?.roles[choice.role]
            }
            onClick={async () => {
              onStart();
              try {
                const response = await login.mutateAsync(choice.role);
                if (response.authRevision === authRevision())
                  router.push(choice.href);
              } catch (error) {
                onError(
                  (error as { response?: { data?: { message?: string } } })
                    .response?.data?.message ||
                    '체험 로그인에 실패했습니다. 다시 시도해주세요.'
                );
              }
            }}
            className="py-2.5 px-4 rounded-lg border border-primary-400 bg-primary-50 text-primary-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="block font-semibold">
              {login.isPending && login.variables === choice.role
                ? '로그인 중...'
                : choice.label}
            </span>
            <span className="block text-xs mt-1">
              {options.isPending
                ? '준비 상태 확인 중'
                : options.isError
                ? '준비 상태를 확인하지 못했습니다'
                : options.data?.roles[choice.role]
                ? choice.description
                : '현재 체험을 준비 중입니다'}
            </span>
          </button>
        ))}
      </div>
      {options.isError && (
        <button
          type="button"
          className="mt-2 text-sm underline"
          onClick={() => options.refetch()}
        >
          준비 상태 다시 확인
        </button>
      )}
      <p className="text-xs text-gray-500 mt-3">
        공용 계정으로 다른 방문자의 활동이 보입니다. 일부 기능은 제한됩니다.
      </p>
      {logoutPending && (
        <p role="alert" className="text-xs text-red-700 mt-2">
          이전 서버 세션의 로그아웃을 완료하지 못했습니다. 다시 로그인하면 세션
          종료부터 재시도합니다.
        </p>
      )}
      {!lockSupported && (
        <p className="text-xs text-gray-500 mt-2">
          이 브라우저에서는 다른 쇼핑몰 탭을 닫고 한 탭에서 체험해주세요.
        </p>
      )}
    </div>
  );
}
