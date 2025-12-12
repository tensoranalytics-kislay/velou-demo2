/**
 * Login Page Layout
 * 
 * This layout is separate from the main AdminLayout to ensure
 * the login page renders full-screen without the admin navbar.
 */

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}


