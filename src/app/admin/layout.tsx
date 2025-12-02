import AdminNav from './AdminNav';

// Force dynamic rendering for all admin pages
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white">
      <AdminNav />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}

