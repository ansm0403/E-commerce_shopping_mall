'use client';
import DemoAccountChoice from './DemoAccountChoice';
import { authRevision } from '../../service/auth-session';

import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useLoginMutation } from "../../hook/useAuthMutation";
import { Form, TextField, CheckboxField } from "./BaseForm";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { AxiosError } from "axios";

/**
 * Open redirect 방어:
 * - 같은 오리진 내부 경로(`/`로 시작, `//`나 `/\`로 시작 안 함)만 허용
 * - 외부 URL이나 프로토콜 상대 URL(`//evil.com`)은 차단해 홈으로 폴백
 */
function safeRedirectPath(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

const loginSchema = z.object({
  email: z
    .string()
    .min(1, "이메일을 입력해주세요.")
    .email("이메일 형식이 올바르지 않습니다."),
  password: z.string().min(8, "비밀번호는 8자 이상 입력해주세요."),
  rememberMe: z.boolean(),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));
  const loginMutation = useLoginMutation();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 이미 로그인된 사람에게 로그인 폼을 보여 주지 않는다 — 다른 탭에서 로그인했거나, 로그인한 채 /login 을 직접 연 경우.
  // 이 화면에서 직접 로그인한 경우는 아래 핸들러가 목적지를 정하므로(데모는 /admin/dashboard) 여기서는 손대지 않는다.
  const { user } = useAuth();
  const loggedInHereRef = useRef(false);
  useEffect(() => {
    if (user && !loggedInHereRef.current) router.replace(redirectTo);
  }, [user, redirectTo, router]);

  const defaultValues: LoginFormValues = {
    email: "",
    password: "",
    rememberMe: false,
  };

  const handleSubmit = async (values: LoginFormValues) => {
    setErrorMessage(null);
    loggedInHereRef.current = true;

    try {
      const response=await loginMutation.mutateAsync({
        email: values.email,
        password: values.password,
        rememberMe: values.rememberMe,
      });

      if(response.authRevision===authRevision()) router.push(redirectTo);
    } catch (error) {
      loggedInHereRef.current = false;
      if (error instanceof AxiosError && error.response?.status === 403) {
        // 이메일 미인증 → 인증 안내 페이지로 이동
        router.push(`/check-email?email=${encodeURIComponent(values.email)}`);
        return;
      }

      const message =
        error instanceof AxiosError
          ? error.response?.data?.message
          : null;

      setErrorMessage(message || "로그인에 실패했습니다.");
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[600px] mx-auto pt-6">
      <Form<LoginFormValues>
        title="로그인"
        description="계정에 로그인 해주세요."
        submitLabel="로그인"
        defaultValues={defaultValues}
        resolver={zodResolver(loginSchema)}
        variant="login"
        onSubmit={handleSubmit}
      >
        <TextField<LoginFormValues>
          name="email"
          label="이메일"
          type="email"
          placeholder="you@example.com"
        />

        <TextField<LoginFormValues>
          name="password"
          label="비밀번호"
          type="password"
          placeholder="비밀번호를 입력해주세요."
        />

        <CheckboxField<LoginFormValues> name="rememberMe">
          로그인 상태 유지
        </CheckboxField>
      </Form>

      {errorMessage && (
        <p role="alert" className="text-sm text-red-600 text-center">{errorMessage}</p>
      )}

      {/* "비밀번호 찾기"(/find-pwd)는 화면이 없어 404 로 가던 링크라 뺐다 — 재설정 기능을 만들면 다시 단다 */}
      <div className="flex items-center gap-3 text-sm">
        <Link
          href="/register"
          className="text-gray-500 no-underline transition-colors duration-200 hover:text-primary-600 hover:font-bold"
        >
          회원가입
        </Link>
      </div>

      <DemoAccountChoice busy={loginMutation.isPending} onStart={() => {setErrorMessage(null); loggedInHereRef.current=true;}} onError={message => {loggedInHereRef.current=false; setErrorMessage(message);}} />
    </div>
  );
}
