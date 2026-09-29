'use client'

import React from 'react'
import UserMenu from './UserMenu';
import Link from 'next/link';

export default function Topbar() {
  return (
    <div className="w-full bg-gray-900">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-8 flex items-center justify-between">
        {/* 페이지 이동은 링크 — 버튼이면 스크린리더가 "버튼"으로 읽고 새 탭 열기·주소 복사가 안 된다 */}
        <Link
          href="/"
          className="text-xs text-gray-400 hover:text-indigo-400 transition-colors select-none"
        >
          <span aria-hidden="true">🎉 </span>신규 회원가입 시 10% 할인 쿠폰 증정
        </Link>
        <UserMenu />
      </div>
    </div>
  )
}
