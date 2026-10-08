'use client'

import React from 'react'
import UserMenu from './UserMenu';
import Link from 'next/link';

export default function Topbar() {
  return (
    <div className="w-full bg-primary-600">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-8 flex items-center justify-between">
        {/* 페이지 이동은 링크 — 버튼이면 스크린리더가 "버튼"으로 읽고 새 탭 열기·주소 복사가 안 된다.
            예전 문구("회원가입 시 10% 쿠폰")는 없는 기능이었다 — 실제로 열리는 데모 입구로 바꿨다 */}
        <Link
          href="/login"
          className="text-xs text-gray-300 hover:text-white transition-colors select-none truncate"
        >
          포트폴리오 쇼핑몰 · 관리자 화면 체험하기 <span aria-hidden="true">→</span>
        </Link>
        <UserMenu />
      </div>
    </div>
  )
}
