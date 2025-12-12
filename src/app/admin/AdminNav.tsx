'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';

const baseNavItems = [
  { href: '/admin/brand-voice', label: 'Brand Voice' },
  { href: '/admin/appearance', label: 'Appearance' },
  { href: '/admin/merch-rules', label: 'Merch Rules' },
  { href: '/admin/catalog', label: 'Catalog Upload' },
  { href: '/admin/llm', label: 'LLM Config' },
  { href: '/admin/metrics', label: 'Metrics' },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [merchantId, setMerchantId] = useState<string | null>(null);

  useEffect(() => {
    // Fetch current user info (using HttpOnly cookies)
    fetch('/api/admin/auth/me', {
      credentials: 'include', // Include HttpOnly cookies
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUserEmail(data.user.email);
          setMerchantId(data.user.merchantId);
        }
      })
      .catch(() => {
        // Token invalid, ignore
      });
  }, []);

  const handleLogout = async () => {
    try {
      // Logout using HttpOnly cookies
      await fetch('/api/admin/auth/logout', {
        method: 'POST',
        credentials: 'include', // Include HttpOnly cookies
      });
    } catch (error) {
      // Ignore errors
    } finally {
      // Clear any localStorage tokens (legacy support)
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      
      // Redirect to login (cookies will be cleared by server)
      router.push('/admin/login');
    }
  };

  return (
    <aside className="w-64 border-r border-slate-200 bg-white p-6">
      <h1 className="mb-8 text-xl font-semibold text-slate-900">Admin Console</h1>
      <nav className="space-y-1">
        {baseNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        {merchantId && (
          <Link
            href={`/admin/${merchantId}/integrations/installation`}
            className={`block rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              pathname?.includes('/integrations/installation')
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            Widget Installation
          </Link>
        )}
      </nav>
      
      <div className="mt-auto border-t border-slate-200 pt-6">
        {userEmail && (
          <p className="mb-2 text-xs text-slate-500">{userEmail}</p>
        )}
        <button
          onClick={handleLogout}
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Log Out
        </button>
      </div>
    </aside>
  );
}

