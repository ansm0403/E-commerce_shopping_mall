'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/contexts/AuthContext';
import { hasRole } from '@/lib/roles';
import { inquirySchema, type InquiryFormValues } from '@/lib/validation/inquiry-schema';
import { useCreateInquiry } from '@/hooks/useInquiry';
import { inquiryErrorMessage } from '@/service/inquiry';
import { CheckboxField, Form, TextField, TextareaField } from '@/components/forms/BaseForm';

interface InquiryFormProps {
  productId: number;
}

const DEFAULT_VALUES: InquiryFormValues = { title: '', content: '', isSecret: false };

/**
 * 상품 문의 작성 폼 — 상태별 분기:
 *   인증 확인 중     → 아무것도 그리지 않는다(로그인 안내가 잠깐 번쩍이지 않게)
 *   비로그인         → 로그인 링크(돌아올 경로 포함)
 *   구매자가 아님    → 안내 한 줄(백엔드가 BUYER 만 받는다)
 *   구매자           → 폼
 */
export default function InquiryForm({ productId }: InquiryFormProps) {
  const { user, isHydrated, isLoading } = useAuth();
  const pathname = usePathname();
  const createMutation = useCreateInquiry();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  // 등록 성공 시 key 를 바꿔 폼을 새로 만든다(= 초기화). BaseForm 이 reset 을 밖으로 내주지 않는다.
  const [formKey, setFormKey] = useState(0);

  if (!isHydrated || isLoading) return null;

  if (!user) {
    return (
      <p className="rounded-lg bg-secondary-50 px-4 py-3 text-sm text-secondary-700">
        문의를 남기려면{' '}
        <Link
          href={`/login?redirect=${encodeURIComponent(pathname)}`}
          className="font-semibold text-primary-700 underline"
        >
          로그인
        </Link>
        이 필요합니다.
      </p>
    );
  }

  if (!hasRole(user, 'buyer')) {
    return (
      <p className="rounded-lg bg-secondary-50 px-4 py-3 text-sm text-secondary-700">
        문의는 구매자 계정으로만 남길 수 있습니다.
      </p>
    );
  }

  const handleSubmit = async (values: InquiryFormValues) => {
    setErrorMessage(null);
    setDoneMessage(null);
    try {
      await createMutation.mutateAsync({ productId, ...values });
      setDoneMessage('문의가 등록되었습니다.');
      setFormKey((k) => k + 1);
    } catch (error) {
      setErrorMessage(inquiryErrorMessage(error));
    }
  };

  return (
    <div>
      <Form<InquiryFormValues>
        key={formKey}
        title="문의하기"
        submitLabel="문의 등록"
        defaultValues={DEFAULT_VALUES}
        resolver={zodResolver(inquirySchema)}
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
        <TextField<InquiryFormValues> name="title" label="제목" placeholder="문의 제목" />
        <TextareaField<InquiryFormValues>
          name="content"
          label="내용"
          placeholder="상품에 대해 궁금한 점을 적어주세요."
        />
        <CheckboxField<InquiryFormValues> name="isSecret">
          비밀글로 작성 (작성자와 판매자만 내용을 볼 수 있습니다)
        </CheckboxField>
      </Form>
      {/* 폼이 새로 만들어져도 남아 있도록 폼 밖에 둔다 */}
      <p role="status" className="mt-2 min-h-5 text-sm text-green-700">
        {doneMessage}
      </p>
    </div>
  );
}
