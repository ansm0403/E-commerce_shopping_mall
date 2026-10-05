'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/contexts/AuthContext';
import {
  changePasswordSchema,
  type ChangePasswordFormValues,
} from '@/lib/validation/password-schema';
import { useChangePassword } from '@/hooks/useUser';
import { userErrorMessage } from '@/service/user';
import { authStorage } from '@/service/auth-storage';
import { Form, TextField } from '@/components/forms/BaseForm';

const DEFAULT_VALUES: ChangePasswordFormValues = {
  currentPassword: '',
  newPassword: '',
  newPasswordConfirm: '',
};

/**
 * 비밀번호 변경 — PATCH /users/me/password. 로그인 가드는 my/layout.tsx.
 *
 * 서버는 변경에 성공하면 이 계정의 **모든 세션을 끊는다**(이 요청의 access 토큰 포함).
 * 그래서 성공 직후 이 브라우저도 로그아웃 처리하고 로그인 화면으로 보낸다 — 낡은 토큰으로 남아 401 을 만나게 두지 않는다.
 * 데모 계정은 서버가 403 으로 막는다(바뀌면 "체험하기"가 모든 방문자에게 실패한다) — 폼을 내지 않고 먼저 알린다.
 */
export default function MyPasswordPage() {
  const { user } = useAuth();
  const changeMutation = useChangePassword();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (values: ChangePasswordFormValues) => {
    setErrorMessage(null);
    try {
      await changeMutation.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
    } catch (error) {
      setErrorMessage(userErrorMessage(error));
      return;
    }

    setDone(true);
    // 세션은 서버에서 이미 끊겼다 — 로그아웃 API 는 부르지 않는다(폐기된 토큰이라 401 → 갱신 시도 → 실패의 헛걸음만 한다).
    // 브라우저에 남은 토큰만 지우고(다른 탭에도 알림) 전체 새로고침으로 로그인 화면에 간다 → 메모리의 캐시도 함께 사라진다.
    authStorage.clearToken();
    window.location.assign('/login?redirect=%2Fmy');
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-secondary-900 mb-2">비밀번호 변경</h1>
      <p className="mb-6 text-sm text-secondary-600">
        변경하면 모든 기기에서 로그아웃됩니다. 새 비밀번호로 다시 로그인해주세요.
      </p>

      {user?.isDemo ? (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          데모 계정은 비밀번호를 변경할 수 없습니다.
        </p>
      ) : done ? (
        <p role="status" className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
          비밀번호가 변경되었습니다. 로그인 화면으로 이동합니다...
        </p>
      ) : (
        <Form<ChangePasswordFormValues>
          submitLabel="비밀번호 변경"
          defaultValues={DEFAULT_VALUES}
          resolver={zodResolver(changePasswordSchema)}
          onSubmit={handleSubmit}
        >
          {errorMessage && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] whitespace-pre-line text-red-600"
            >
              {errorMessage}
            </p>
          )}
          <TextField<ChangePasswordFormValues> name="currentPassword" label="현재 비밀번호" type="password" />
          <TextField<ChangePasswordFormValues>
            name="newPassword"
            label="새 비밀번호"
            type="password"
            helperText="8자 이상, 대문자·소문자·숫자·특수문자(@$!%*?&) 포함"
          />
          <TextField<ChangePasswordFormValues> name="newPasswordConfirm" label="새 비밀번호 확인" type="password" />
        </Form>
      )}
    </div>
  );
}
