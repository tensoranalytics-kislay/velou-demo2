'use client';

import { usePathname } from 'next/navigation';
import AdminNav from './AdminNav';

/**
 * Conditional Admin Layout
 * 
 * Client component that conditionally renders the admin navbar
 * based on the current pathname. The login page should render
 * full-screen without the navbar.
 */
export default function ConditionalAdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === '/admin/login' || pathname.startsWith('/admin/login/');
  
  // For login page, render full-screen without navbar
  if (isLoginPage) {
    return <>{children}</>;
  }
  
  // For all other admin pages, render with navbar
  return (
    <div className="flex min-h-screen bg-white">
      <AdminNav />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}


