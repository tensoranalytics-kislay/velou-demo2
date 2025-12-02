'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/admin/brand-voice', label: 'Brand Voice' },
  { href: '/admin/appearance', label: 'Appearance' },
  { href: '/admin/merch-rules', label: 'Merch Rules' },
  { href: '/admin/catalog', label: 'Catalog Upload' },
  { href: '/admin/llm', label: 'LLM Config' },
  { href: '/admin/metrics', label: 'Metrics' },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-slate-200 bg-white p-6">
      <h1 className="mb-8 text-xl font-semibold text-slate-900">Admin Console</h1>
      <nav className="space-y-1">
        {navItems.map((item) => {
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
      </nav>
    </aside>
  );
}

