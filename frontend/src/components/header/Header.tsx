'use client'

import React, { Suspense } from 'react';
import Topbar from './topbar/Topbar';
import MainHeader from './mainHeader/MainHeader';
import Category from './navbar/Category';
import CategoryBar from './navbar/CategoryBar';

export default function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-primary-100 bg-[#fafaf7]/95 backdrop-blur-xl">
      <Topbar />
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-10">
        <Suspense fallback={<div className="h-16 w-full animate-pulse bg-gray-100 rounded-full my-4" />}>
          <MainHeader />
        </Suspense>
        <div className="flex min-w-0 items-center gap-3 border-t border-primary-100">
          <Category />
          <CategoryBar />
        </div>
      </div>
    </header>
  );
}
