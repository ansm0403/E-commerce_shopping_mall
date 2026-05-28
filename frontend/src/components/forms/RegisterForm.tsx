"use client";

import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRegisterMutation } from "../../hook/useAuthMutation";
import type { RegisterRequest } from "@shopping-mall/shared";

import {
  Form,
  TextField,
  CheckboxField,
} from "./BaseForm";

const signupSchema = z
  .object({
    email: z
      .string()
      .min(1, "이메일을 입력해주세요.")
      .email("이메일 형식이 올바르지 않습니다."),
    password: z
      .string()
      .min(8, "비밀번호는 8자 이상이어야 합니다.")
      .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
        message: "비밀번호는 대문자, 소문자, 숫자, 특수문자를 포함해야 합니다",
      }),
    passwordConfirm: z.string().min(8, "비밀번호 확인도 8자 이상이어야 합니다."),
    nickName: z.string().min(2, "닉네임은 2자 이상이어야 합니다."),
    phoneNumber: z
      .string()
      .regex(/^01[0-9]{8,9}$/, {
        message: "전화번호는 01012345678 형식으로 입력해주세요 (- 제외)",
      }),
    address: z.string().min(1, "주소를 입력해주세요."),
    agreeTerms: z.literal(true, {
      message: "약관에 동의해야 합니다.",
    }),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "비밀번호가 일치하지 않습니다.",
    path: ["passwordConfirm"],
  });

export type SignupFormValues = z.infer<typeof signupSchema>;

export function SignupForm() {
  const router = useRouter();
  const registerMutation = useRegisterMutation();

  const defaultValues: SignupFormValues = {
    email: "",
    password: "",
    passwordConfirm: "",
    nickName: "",
    phoneNumber: "",
    address: "",
    agreeTerms: true,
  };

  const handleSubmit = async (values: SignupFormValues) => {
    try {
      // passwordConfirm은 백엔드에 보내지 않음
      const { passwordConfirm, agreeTerms, ...registerData } = values;

      await registerMutation.mutateAsync(registerData as RegisterRequest);

      // 회원가입 성공 후 이메일 인증 안내 페이지로 리다이렉트
      router.push(`/check-email?email=${encodeURIComponent(values.email)}`);

    } catch (error) {
      console.error("회원가입 실패:", error);
      const axiosErr = error as { response?: { data?: { message?: unknown } } };
      const message = axiosErr?.response?.data?.message ?? "회원가입에 실패했습니다.";
      alert(Array.isArray(message) ? message.join("\n") : String(message));
    }
  };

  return (
    <Form<SignupFormValues>
      title="회원가입"
      description="새 계정을 만들어주세요."
      submitLabel="회원가입"
      defaultValues={defaultValues}
      resolver={zodResolver(signupSchema)}
      variant="signup"
      onSubmit={handleSubmit}
    >
      <TextField<SignupFormValues>
        name="email"
        label="이메일"
        type="email"
        placeholder="you@example.com"
      />

      <TextField<SignupFormValues>
        name="nickName"
        label="이름"
        placeholder="홍길동"
      />

      <TextField<SignupFormValues>
        name="phoneNumber"
        label="전화번호"
        type="tel"
        placeholder="01012345678 (- 제외)"
      />

      <TextField<SignupFormValues>
        name="address"
        label="주소"
        placeholder="서울시 강남구 테헤란로"
      />

      <TextField<SignupFormValues>
        name="password"
        label="비밀번호"
        type="password"
        placeholder="대문자, 소문자, 숫자, 특수문자 포함 8자 이상"
      />

      <TextField<SignupFormValues>
        name="passwordConfirm"
        label="비밀번호 확인"
        type="password"
        placeholder="비밀번호를 다시 입력해주세요."
      />

      <CheckboxField<SignupFormValues> name="agreeTerms">
        서비스 이용 약관에 동의합니다.
      </CheckboxField>
    </Form>
  );
}