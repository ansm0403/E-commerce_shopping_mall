import { useAuth } from '../../../contexts/AuthContext';
import Link from 'next/link';
import { NavbarButton } from './NavbarButton';
import React from 'react';
import { useRouter } from 'next/navigation';

export default function NavbarUserSection() {
  const { isLoading, isAuthenticated, isHydrated, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout API failed:', error);
    }
    router.push('/');
  };

  // Hydration이 완료되지 않았거나 로딩 중일 때는 일관된 UI 표시
  if (!isHydrated || isLoading) {
    return (
      <>
        <Link href={'/login'}>
          <NavbarButton>로그인/회원가입</NavbarButton>
        </Link>
      </>
    );
  }

  if (isAuthenticated) {
    return (
      <>
        <NavbarButton onClick={handleLogout}>로그아웃</NavbarButton>
      </>
    );
  }

  return (
    <>
      <Link href={'/login'}>
        <NavbarButton>로그인/회원가입</NavbarButton>
      </Link>
    </>
  );
}
