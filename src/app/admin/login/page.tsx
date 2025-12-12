'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // REMOVED: Auto-redirect check on mount
  // This was causing redirect loops. The middleware will handle redirects.
  // If user is already logged in, they should be redirected by middleware before reaching this page.

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // Normalize email (trim and lowercase)
      const normalizedEmail = email.trim().toLowerCase();
      
      if (!normalizedEmail || !password) {
        setError('Please enter both email and password');
        setIsLoading(false);
        return;
      }

      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies in request and response
        body: JSON.stringify({ email: normalizedEmail, password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Login failed' }));
        throw new Error(data.error || 'Login failed');
      }

      const data = await response.json();
      
      // Store tokens in localStorage (for client-side API calls)
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      
      // CRITICAL: The API response sets cookies via Set-Cookie headers.
      // However, when using fetch(), cookies might not be immediately available
      // for the next navigation. We need to ensure cookies are set properly.
      
      // Method 1: Manually set cookies via document.cookie
      const maxAge = 60 * 60 * 24 * 7; // 7 days
      const cookieOptions = `path=/; max-age=${maxAge}; SameSite=Lax`;
      document.cookie = `accessToken=${data.accessToken}; ${cookieOptions}`;
      document.cookie = `refreshToken=${data.refreshToken}; ${cookieOptions}`;
      
      // Method 2: Verify cookies are actually set
      const cookiesSet = document.cookie.includes('accessToken=');
      console.log('[Login] Cookies set:', {
        cookiesSet,
        cookieString: document.cookie.substring(0, 100),
      });
      
      // Wait to ensure cookies are processed
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Use window.location.href for full page reload
      // This ensures cookies are sent with the request to middleware
      const redirect = searchParams.get('redirect') || '/admin';
      console.log('[Login] Redirecting to:', redirect);
      window.location.href = redirect;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-2xl font-semibold text-slate-900">Admin Login</h1>
        
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              type="text"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Need an account? Contact your administrator.
        </p>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="mb-6 text-2xl font-semibold text-slate-900">Admin Login</h1>
          <p className="text-sm text-slate-600">Loading...</p>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

