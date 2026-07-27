'use client';

import { useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ApplySellerRequest, SellerApplication } from '@shopping-mall/shared';
import { Form, TextField } from '../../../../../components/forms/BaseForm';
import {
  sellerErrorMessage,
  useApplySellerMutation,
} from '../../../../../hooks/seller-query-options';

/**
 * 셀러 신청 폼 — 검증 규칙은 백엔드 ApplySellerDto 와 1:1로 맞춘다.
 * (프론트에서 먼저 걸러도 최종 판정은 백엔드 ValidationPipe 가 한다)
 */
const applySchema = z.object({
  businessName: z.string().min(1, '상호명을 입력해주세요.'),
  businessNumber: z
    .string()
    .regex(/^\d{3}-\d{2}-\d{5}$/, '사업자 등록번호는 000-00-00000 형식으로 입력해주세요.'),
  representativeName: z.string().min(1, '대표자명을 입력해주세요.'),
  businessAddress: z.string().min(1, '사업장 주소를 입력해주세요.'),
  // 선택 필드 — 빈 문자열은 허용하되 전송 직전에 제거한다(백엔드 @IsEmail 이 빈 값을 거른다).
  contactEmail: z.union([z.literal(''), z.string().email('올바른 이메일 형식을 입력해주세요.')]),
  contactPhone: z.string(),
  bankName: z.string().min(1, '은행명을 입력해주세요.'),
  bankAccountNumber: z.string().min(1, '계좌번호를 입력해주세요.'),
  bankAccountHolder: z.string().min(1, '예금주명을 입력해주세요.'),
});

export type SellerApplyFormValues = z.infer<typeof applySchema>;

interface Props {
  /** 반려 후 재신청일 때 이전 신청 내용을 채워준다(은행 정보는 응답에 없어 제외). */
  previous?: SellerApplication | null;
  /** 신청 성공 시 부모가 상태 뷰로 되돌리도록 */
  onApplied?: () => void;
  onCancel?: () => void;
}

export default function SellerApplyForm({ previous, onApplied, onCancel }: Props) {
  const applyMutation = useApplySellerMutation();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isReapply = !!previous;

  const defaultValues: SellerApplyFormValues = {
    businessName: previous?.businessName ?? '',
    businessNumber: previous?.businessNumber ?? '',
    representativeName: previous?.representativeName ?? '',
    businessAddress: previous?.businessAddress ?? '',
    contactEmail: previous?.contactEmail ?? '',
    contactPhone: previous?.contactPhone ?? '',
    bankName: '',
    bankAccountNumber: '',
    bankAccountHolder: '',
  };

  const handleSubmit = async (values: SellerApplyFormValues) => {
    setErrorMessage(null);
    try {
      await applyMutation.mutateAsync(values as ApplySellerRequest);
      onApplied?.();
    } catch (error) {
      setErrorMessage(sellerErrorMessage(error));
    }
  };

  return (
    <div className="w-full">
      <Form<SellerApplyFormValues>
        title={isReapply ? '셀러 재신청' : '셀러 신청'}
        description={
          isReapply
            ? '반려 사유를 반영해 다시 신청합니다. 계좌 정보는 보안상 저장된 값을 다시 보여주지 않으므로 새로 입력해주세요.'
            : '사업자 정보와 정산받을 계좌를 입력하면 관리자 승인 후 셀러 기능이 열립니다.'
        }
        submitLabel={isReapply ? '다시 신청하기' : '신청하기'}
        defaultValues={defaultValues}
        resolver={zodResolver(applySchema)}
        variant="signup"
        onSubmit={handleSubmit}
      >
        {errorMessage && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] whitespace-pre-line text-red-600">
            {errorMessage}
          </p>
        )}

        <p className="text-[13px] font-semibold text-gray-800">사업자 정보</p>

        <TextField<SellerApplyFormValues>
          name="businessName"
          label="상호명"
          placeholder="쇼핑상회"
        />
        <TextField<SellerApplyFormValues>
          name="businessNumber"
          label="사업자 등록번호"
          placeholder="000-00-00000"
          helperText="하이픈(-)을 포함해 입력해주세요."
        />
        <TextField<SellerApplyFormValues>
          name="representativeName"
          label="대표자명"
          placeholder="홍길동"
        />
        <TextField<SellerApplyFormValues>
          name="businessAddress"
          label="사업장 주소"
          placeholder="서울시 마포구 사업자로 1"
        />
        <TextField<SellerApplyFormValues>
          name="contactEmail"
          label="담당자 이메일 (선택)"
          type="email"
          placeholder="contact@example.com"
        />
        <TextField<SellerApplyFormValues>
          name="contactPhone"
          label="담당자 연락처 (선택)"
          type="tel"
          placeholder="02-1234-5678"
        />

        <p className="mt-2 text-[13px] font-semibold text-gray-800">정산 계좌</p>
        <p className="-mt-2 text-xs text-gray-500">
          판매 대금을 받을 계좌입니다. 관리자 화면에도 노출되지 않습니다.
        </p>

        <TextField<SellerApplyFormValues> name="bankName" label="은행명" placeholder="국민은행" />
        <TextField<SellerApplyFormValues>
          name="bankAccountNumber"
          label="계좌번호"
          placeholder="123456-78-901234"
        />
        <TextField<SellerApplyFormValues>
          name="bankAccountHolder"
          label="예금주명"
          placeholder="홍길동"
        />
      </Form>

      {onCancel && (
        <div className="mx-auto mt-3 max-w-[520px] text-center">
          <button
            type="button"
            onClick={onCancel}
            className="text-[13px] text-gray-500 underline hover:text-gray-700"
          >
            이전 신청 내역으로 돌아가기
          </button>
        </div>
      )}
    </div>
  );
}
