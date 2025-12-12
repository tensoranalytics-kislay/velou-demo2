/**
 * Role-Based Authorization Middleware
 * 
 * Provides simplified role checking that uses the session's merchantId.
 * This is a convenience wrapper around requireRole from auth.ts.
 */

import { requireRole, type UserRole } from './auth';
// Request is a global type in Next.js, no need to import

/**
 * Require authentication AND verify user has required role
 * 
 * Simplified version that uses the merchantId from the authenticated session.
 * 
 * @param req - Next.js Request object
 * @param allowedRoles - Array of roles that are allowed
 * @returns SessionData if authentication and role check pass
 * @throws AuthError with 401 if authentication fails, 403 if role insufficient
 * 
 * Example:
 *   try {
 *     const session = await requireRoleForRequest(request, ['ADMIN', 'EDITOR']);
 *     // User is authenticated and is ADMIN or EDITOR
 *   } catch (error) {
 *     if (error.status === 401) {
 *       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *     }
 *     return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 *   }
 */
export async function requireRoleForRequest(
  req: Request,
  allowedRoles: UserRole[]
): Promise<Awaited<ReturnType<typeof requireAuth>>> {
  // First get the session to extract merchantId
  const { requireAuth } = await import('./auth');
  const session = await requireAuth(req);
  
  // Then check role with merchantId
  return requireRole(req, session.merchantId, allowedRoles);
}


