import { redirect } from 'next/navigation';

export default function AdminPage() {
  // Redirect to catalog upload page as the default admin page
  redirect('/admin/catalog');
}



