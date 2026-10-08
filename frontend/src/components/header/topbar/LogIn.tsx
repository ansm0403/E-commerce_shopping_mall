'use client'

import Link from 'next/link'
import React from 'react'

export default function LogIn() {
  return (
    <Link
      href="/login"
      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary-400 transition-colors select-none"
    >
      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/>
      </svg>
      <span>로그인/회원가입</span>
    </Link>
  )
}
