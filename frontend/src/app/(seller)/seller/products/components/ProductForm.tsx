'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import type { CreateProductRequest, SellerProduct } from '@shopping-mall/shared';
import {
  CheckboxField,
  Form,
  SelectField,
  TextareaField,
  TextField,
  type SelectOption,
} from '../../../../../components/forms/BaseForm';
import { categoryQueryOptions } from '../../../../../lib/react-query/category-query-options';
import type { CategoryTreeNode } from '../../../../../service/category';
import {
  sellerProductErrorMessage,
  useCreateProductMutation,
  useUpdateProductMutation,
} from '../../../../../hooks/seller-product-query-options';

/**
 * 상품 등록/수정 공용 폼 (01-seller-core §1-A②).
 *
 * 등록은 2단계 API 다 — POST /products 로 상품을 만든 뒤, 성공한 id 로
 * POST /products/:id/images 에 이미지를 올린다. 그래서 이미지 업로드 실패는
 * "등록 실패"가 아니라 "이미지만 추가 못 함"으로 안내한다(ImageUploadError).
 *
 * 검증 규칙은 백엔드 CreateProductDto 와 1:1. 숫자 필드는 폼에서 문자열로 받아
 * 전송 직전에 변환한다 — react-hook-form register 가 문자열을 주기 때문.
 */

const productSchema = z.object({
  name: z.string().min(1, '상품명을 입력해주세요.'),
  description: z.string().min(1, '상품 설명을 입력해주세요.'),
  price: z
    .string()
    .min(1, '가격을 입력해주세요.')
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, '0 이상의 숫자로 입력해주세요.'),
  brand: z.string().min(1, '브랜드를 입력해주세요.'),
  stockQuantity: z
    .string()
    .refine(
      (v) => v === '' || (Number.isInteger(Number(v)) && Number(v) >= 0),
      '재고는 0 이상의 정수로 입력해주세요.',
    ),
  discountRate: z
    .string()
    .refine(
      (v) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100),
      '할인율은 0~100 사이 숫자로 입력해주세요.',
    ),
  categoryId: z.string(),
  salesType: z.enum(['normal', 'pre_order', 'group_buy']),
  isEvent: z.boolean(),
});

export type ProductFormValues = z.infer<typeof productSchema>;

const SALES_TYPE_OPTIONS: SelectOption[] = [
  { value: 'normal', label: '일반 판매' },
  { value: 'pre_order', label: '예약 판매' },
  { value: 'group_buy', label: '공동구매' },
];

const MAX_IMAGES = 10; // 백엔드 ProductService.MAX_IMAGES_PER_PRODUCT 와 동일
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // multer limits 와 동일 (5MB)

/** 카테고리 트리 → 셀렉트 옵션 (하위는 들여쓰기로 표현) */
function flattenCategories(nodes: CategoryTreeNode[], depth = 0): SelectOption[] {
  return nodes.flatMap((node) => [
    { value: String(node.id), label: `${'\u00A0'.repeat(depth * 3)}${node.name}` },
    ...flattenCategories(node.children ?? [], depth + 1),
  ]);
}

function toRequest(values: ProductFormValues): CreateProductRequest {
  return {
    name: values.name,
    description: values.description,
    price: Number(values.price),
    brand: values.brand,
    stockQuantity: values.stockQuantity === '' ? 0 : Number(values.stockQuantity),
    isEvent: values.isEvent,
    ...(values.discountRate !== '' && { discountRate: Number(values.discountRate) }),
    ...(values.categoryId !== '' && { categoryId: Number(values.categoryId) }),
    salesType: values.salesType,
  };
}

interface Props {
  /** 있으면 수정 모드 — PATCH /products/:id (내용 수정 = 재심사 발동) */
  initial?: SellerProduct;
}

export default function ProductForm({ initial }: Props) {
  const router = useRouter();
  const isEdit = !!initial;

  const createMutation = useCreateProductMutation();
  const updateMutation = useUpdateProductMutation();
  const { data: categoryTree } = useQuery(categoryQueryOptions.tree());

  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const categoryOptions = useMemo(
    () => flattenCategories(categoryTree ?? []),
    [categoryTree],
  );

  const existingImageCount = initial?.images?.length ?? 0;

  const defaultValues: ProductFormValues = {
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    price: initial != null ? String(initial.price) : '',
    brand: initial?.brand ?? '',
    stockQuantity: initial != null ? String(initial.stockQuantity) : '',
    discountRate: initial?.discountRate != null ? String(initial.discountRate) : '',
    categoryId: initial?.categoryId != null ? String(initial.categoryId) : '',
    salesType: (initial?.salesType as ProductFormValues['salesType']) ?? 'normal',
    isEvent: initial?.isEvent ?? false,
  };

  const addFiles = (list: FileList | null) => {
    setFileError(null);
    if (!list) return;
    const incoming = Array.from(list);
    const oversize = incoming.find((f) => f.size > MAX_IMAGE_SIZE);
    if (oversize) {
      setFileError(`'${oversize.name}' 는 5MB 를 넘습니다.`);
      return;
    }
    const next = [...files, ...incoming];
    if (existingImageCount + next.length > MAX_IMAGES) {
      setFileError(`이미지는 상품당 최대 ${MAX_IMAGES}장까지 등록할 수 있습니다.`);
      return;
    }
    setFiles(next);
    // 같은 파일을 다시 선택할 수 있도록 input 을 비운다
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (values: ProductFormValues) => {
    setErrorMessage(null);
    const dto = toRequest(values);
    try {
      if (isEdit && initial) {
        await updateMutation.mutateAsync({ id: initial.id, dto, images: files });
      } else {
        await createMutation.mutateAsync({ dto, images: files });
      }
      router.push('/seller/products');
    } catch (error) {
      setErrorMessage(sellerProductErrorMessage(error));
    }
  };

  return (
    <div className="w-full">
      <Form<ProductFormValues>
        title={isEdit ? '상품 수정' : '상품 등록'}
        description={
          isEdit
            ? '내용을 수정해 저장하면 관리자 재심사(승인 대기)로 전환됩니다. 게시/숨김만 바꾸려면 목록의 토글을 사용하세요.'
            : '등록한 상품은 관리자 승인 후 상점에 게시됩니다.'
        }
        submitLabel={isEdit ? '수정 저장 (재심사 요청)' : '등록하기'}
        defaultValues={defaultValues}
        resolver={zodResolver(productSchema)}
        onSubmit={handleSubmit}
      >
        {errorMessage && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] whitespace-pre-line text-red-600">
            {errorMessage}
          </p>
        )}

        {isEdit && initial?.approvalStatus === 'rejected' && initial.rejectionReason && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-600">
            반려 사유: {initial.rejectionReason}
            <br />
            수정해 저장하면 자동으로 재심사가 요청됩니다.
          </p>
        )}

        <TextField<ProductFormValues> name="name" label="상품명" placeholder="예: 프리미엄 원두 1kg" />
        <TextareaField<ProductFormValues>
          name="description"
          label="상품 설명"
          placeholder="상품의 특징, 구성, 사용법 등을 적어주세요."
          rows={6}
        />
        <TextField<ProductFormValues> name="brand" label="브랜드" placeholder="예: 쇼핑상회" />
        <TextField<ProductFormValues>
          name="price"
          label="가격 (원)"
          type="number"
          placeholder="19900"
        />
        <TextField<ProductFormValues>
          name="stockQuantity"
          label="재고 수량"
          type="number"
          placeholder="0"
          helperText="비워두면 0으로 등록됩니다. 재고가 0이면 구매자가 주문할 수 없습니다."
        />
        <TextField<ProductFormValues>
          name="discountRate"
          label="할인율 % (선택)"
          type="number"
          placeholder="0~100"
        />
        <SelectField<ProductFormValues>
          name="categoryId"
          label="카테고리 (선택)"
          options={categoryOptions}
          placeholder="카테고리 미지정"
        />
        <SelectField<ProductFormValues>
          name="salesType"
          label="판매 방식"
          options={SALES_TYPE_OPTIONS}
        />
        <CheckboxField<ProductFormValues> name="isEvent">이벤트 상품</CheckboxField>

        {/* 이미지 — react-hook-form 밖에서 관리(파일은 등록 성공 후 별도 API 로 올라간다) */}
        <div className="flex flex-col gap-3">
          <label className="text-[13px] font-medium">
            상품 이미지 (선택, 최대 {MAX_IMAGES}장 · 장당 5MB)
          </label>
          <p className="text-xs text-gray-500">
            첫 번째 이미지가 대표 이미지가 됩니다.{' '}
            {isEdit
              ? `이미 등록된 이미지 ${existingImageCount}장 뒤에 추가됩니다.`
              : '이미지는 상품 등록이 완료된 뒤 순서대로 업로드됩니다.'}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => addFiles(e.target.files)}
            className="text-[13px]"
          />
          {fileError && <span className="text-xs text-red-500">{fileError}</span>}
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="h-20 w-20 rounded-md border border-gray-200 object-cover"
                  />
                  {index === 0 && !isEdit && (
                    <span className="absolute left-1 top-1 rounded bg-blue-600 px-1 text-[10px] text-white">
                      대표
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-gray-800 text-[11px] leading-5 text-white"
                    aria-label={`${file.name} 제거`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Form>
    </div>
  );
}
