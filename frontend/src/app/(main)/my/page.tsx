'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import type { UpdateProfileRequest, UserProfileResponse } from '@shopping-mall/shared';
import { useAuth } from '@/contexts/AuthContext';
import { userQueryOptions } from '@/lib/react-query/user-query-options';
import { profileSchema, type ProfileFormValues } from '@/lib/validation/profile-schema';
import { useUpdateProfile } from '@/hooks/useUser';
import { userErrorMessage } from '@/service/user';
import { Form, TextField } from '@/components/forms/BaseForm';

const SHORTCUTS = [
  { href: '/my/orders', label: '주문 내역', description: '주문·배송 상태 확인' },
  { href: '/my/reviews', label: '내 리뷰', description: '작성한 리뷰 관리' },
  { href: '/my/wishlist', label: '위시리스트', description: '찜한 상품 모아 보기' },
  { href: '/my/inquiries', label: '내 문의', description: '문의와 판매자 답변' },
] as const;

/** 마이페이지 홈 — 프로필 카드(인라인 수정) + 하위 화면 바로가기. 로그인 가드는 my/layout.tsx. */
export default function MyPage() {
  const { user } = useAuth();
  const { data: profile, isLoading, isError } = useQuery(userQueryOptions.me());
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 데모 계정은 서버가 수정을 403 으로 막는다 — 누르기 전에 먼저 알려 준다.
  const isDemo = !!user?.isDemo;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold text-secondary-900">내 정보</h1>

      <section aria-labelledby="profile-heading" className="rounded-xl border border-secondary-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="profile-heading" className="text-base font-bold text-secondary-900">
            프로필
          </h2>
          {profile && !editing && !isDemo && (
            <button
              onClick={() => {
                setNotice(null);
                setEditing(true);
              }}
              className="rounded-lg border border-secondary-300 px-3 py-1.5 text-sm font-semibold text-secondary-700 hover:bg-secondary-50"
            >
              수정
            </button>
          )}
        </div>

        {isLoading ? (
          <p className="py-6 text-sm text-secondary-600">프로필을 불러오는 중...</p>
        ) : isError || !profile ? (
          <p role="alert" className="py-6 text-sm text-red-600">
            프로필을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
          </p>
        ) : editing ? (
          <ProfileEditForm
            profile={profile}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              setNotice('프로필이 수정되었습니다.');
            }}
          />
        ) : (
          <ProfileView profile={profile} />
        )}

        {isDemo && (
          <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
            데모 계정은 프로필을 변경할 수 없습니다.
          </p>
        )}
        <p role="status" className="mt-3 min-h-5 text-sm text-green-700">
          {notice}
        </p>
      </section>

      <section aria-labelledby="shortcut-heading">
        <h2 id="shortcut-heading" className="mb-3 text-base font-bold text-secondary-900">
          바로가기
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SHORTCUTS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block rounded-xl border border-secondary-200 bg-white p-4 hover:border-primary-300 hover:bg-primary-50"
              >
                <span className="block text-sm font-semibold text-secondary-900">{item.label}</span>
                <span className="block text-xs text-secondary-600">{item.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ProfileView({ profile }: { profile: UserProfileResponse }) {
  const rows = [
    { label: '닉네임', value: profile.nickName },
    {
      label: '이메일',
      value: (
        <>
          {profile.email}
          <span
            className={`ml-2 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
              profile.isEmailVerified ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {profile.isEmailVerified ? '인증 완료' : '미인증'}
          </span>
        </>
      ),
    },
    { label: '연락처', value: profile.phoneNumber || '—' },
    { label: '주소', value: profile.address || '—' },
  ];

  return (
    <dl className="grid grid-cols-[80px_1fr] gap-x-4 gap-y-3 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-secondary-600">{row.label}</dt>
          <dd className="min-w-0 break-words text-secondary-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProfileEditForm({
  profile,
  onCancel,
  onSaved,
}: {
  profile: UserProfileResponse;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const updateMutation = useUpdateProfile();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const current: ProfileFormValues = {
    nickName: profile.nickName ?? '',
    phoneNumber: profile.phoneNumber ?? '',
    address: profile.address ?? '',
  };

  const handleSubmit = async (values: ProfileFormValues) => {
    setErrorMessage(null);
    // 바뀐 필드만 보낸다(백엔드는 보낸 필드만 고친다)
    const changed: UpdateProfileRequest = {};
    (Object.keys(values) as Array<keyof ProfileFormValues>).forEach((key) => {
      if (values[key] !== current[key]) changed[key] = values[key];
    });
    if (Object.keys(changed).length === 0) {
      onCancel();
      return;
    }
    try {
      await updateMutation.mutateAsync(changed);
      onSaved();
    } catch (error) {
      setErrorMessage(userErrorMessage(error));
    }
  };

  return (
    <div>
      <Form<ProfileFormValues>
        submitLabel="저장"
        defaultValues={current}
        resolver={zodResolver(profileSchema)}
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
        <TextField<ProfileFormValues> name="nickName" label="닉네임" helperText="2~20자" />
        <TextField<ProfileFormValues> name="phoneNumber" label="연락처" helperText="10~15자" />
        <TextField<ProfileFormValues> name="address" label="주소" helperText="5~200자" />
      </Form>
      <button
        onClick={onCancel}
        disabled={updateMutation.isPending}
        className="mt-3 rounded-lg border border-secondary-300 px-3 py-1.5 text-sm font-semibold text-secondary-700 hover:bg-secondary-50"
      >
        취소
      </button>
    </div>
  );
}
