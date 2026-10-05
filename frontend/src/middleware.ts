import { NextResponse, type NextRequest } from 'next/server';

/** 콘솔 구역 — refreshToken 쿠키가 없으면 화면을 그리기 전에 로그인으로 보낸다(역할 검증은 각 가드와 백엔드) */
const PROTECTED_PREFIXES = ['/admin', '/seller'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) return NextResponse.next();

  const refreshToken = req.cookies.get('refreshToken')?.value;
  if (!refreshToken) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/seller/:path*'],
};
