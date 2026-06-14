'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import LogIn from './LogIn';

export default function UserMenu() {
  const { user, isHydrated, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await logout();
    setShowConfirm(false);
    setOpen(false);
  };

  if (!isHydrated) return null;
  if (!user) return <LogIn />;

  // roles 런타임 형태는 [{ name: 'admin' }] (shared 타입은 string[]로 선언 — 미스매치 방어적 처리)
  const isAdmin =
    Array.isArray(user.roles) &&
    (user.roles as Array<string | { name?: string }>).some(
      (r) => (typeof r === 'string' ? r : r?.name) === 'admin',
    );

  const items: { label: string; onClick: () => void; danger?: boolean; admin?: boolean }[] = [
    { label: "내 정보", onClick: () => void 0 },
    { label: "주문 목록", onClick: () => { router.push('/my/orders'); setOpen(false); } },
    { label: "장바구니", onClick: () => { router.push('/cart'); setOpen(false); } },
    ...(isAdmin
      ? [{
          label: "관리자 페이지",
          onClick: () => { router.push('/admin/dashboard'); setOpen(false); },
          admin: true,
        }]
      : []),
    { label: "로그아웃", onClick: () => setShowConfirm(true), danger: true },
  ];

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-400 transition-colors select-none cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
          <span>{user.nickName}님</span>
          <svg
            xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          >
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-40 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-[500]">
            {items.map((item) => (
              <button
                key={item.label}
                onClick={item.onClick}
                className={`w-full flex items-center px-4 py-2.5 text-sm transition-colors text-left ${
                  item.danger
                    ? 'text-red-500 hover:bg-red-50'
                    : item.admin
                      ? 'text-indigo-600 font-semibold hover:bg-indigo-50'
                      : 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl px-8 py-6 flex flex-col items-center gap-4">
            <p className="text-gray-800 font-medium">로그아웃 하시겠습니까?</p>
            <div className="flex gap-3">
              <button
                onClick={handleLogout}
                className="px-5 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors font-medium"
              >
                로그아웃
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="px-5 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
