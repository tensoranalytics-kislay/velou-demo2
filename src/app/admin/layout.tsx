import AdminNav from './AdminNav';
import ConditionalAdminLayout from './ConditionalAdminLayout';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Use a client component to conditionally render based on pathname
  // This allows us to check the current route and hide the navbar on login page
  return <ConditionalAdminLayout>{children}</ConditionalAdminLayout>;
}

