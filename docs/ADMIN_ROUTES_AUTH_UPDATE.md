# Admin Routes Authentication Update

## Summary

All admin API routes have been updated to require JWT authentication. This ensures that only authenticated users can access admin functionality.

## Updated Routes

### ✅ Protected Routes (Require Authentication)

1. **`/api/admin/brand-config`** (PATCH)
   - Requires: Authentication (any role)
   - Updates brand configuration

2. **`/api/admin/catalog/upload`** (POST)
   - Requires: Authentication (any role)
   - Uploads CSV catalog

3. **`/api/admin/catalog/clear`** (DELETE)
   - Requires: **ADMIN role only**
   - Destructive operation - only admins can clear catalog

4. **`/api/admin/merch-rules`** (POST)
   - Requires: Authentication (any role)
   - Creates merchandising rules

5. **`/api/admin/merch-rules/[id]`** (PATCH, DELETE)
   - Requires: Authentication (any role)
   - Updates/deletes merchandising rules

6. **`/api/admin/brand-logo`** (POST)
   - Requires: Authentication (any role)
   - Uploads brand logo

7. **`/api/admin/products`** (GET)
   - Requires: Authentication (any role)
   - Lists products

8. **`/api/admin/metrics/product-clicks`** (GET)
   - Requires: Authentication (any role)
   - Gets product click metrics

## Authentication Flow

All protected routes now follow this pattern:

```typescript
import { requireAuth, requireRole, createAuthErrorResponse } from '@/middleware/auth';

export async function GET(request: NextRequest) {
  try {
    // Require authentication
    const session = await requireAuth(request);
    
    // Optional: Require specific role
    // await requireRole(request, session.merchantId, ['ADMIN']);
    
    // Proceed with request...
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }
    // Handle other errors...
  }
}
```

## Role-Based Access Control

- **ADMIN**: Full access to all routes
- **EDITOR**: Can create/update most resources, cannot delete catalog
- **VIEWER**: Read-only access (if implemented)

Currently, most routes allow any authenticated user. Only `/api/admin/catalog/clear` requires ADMIN role.

## Testing

Use the test script to verify authentication:

```bash
./scripts/test-auth-endpoints.sh
```

Or manually test with curl:

```bash
# 1. Login
curl -X POST http://localhost:3000/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@velou.local","password":"admin123"}'

# 2. Use token in protected route
curl -X GET http://localhost:3000/api/admin/products \
  -H "Authorization: Bearer <accessToken>"
```

## Migration Notes

### TODO Items

Several routes still have TODO comments for post-migration updates:

1. **BrandConfig → Merchant**: Routes using `BrandConfig` need to be updated to use `Merchant` after migration
2. **merchantId filtering**: Product queries need to filter by `merchantId` after migration
3. **MerchRule merchantId**: MerchRule creation/updates need to verify `merchantId` matches

### Current State

- ✅ All routes require authentication
- ✅ Error handling with proper status codes
- ✅ Logging for audit trail
- ⚠️ Some routes still use `BrandConfig` (will be updated after migration)
- ⚠️ Some routes don't filter by `merchantId` yet (will be added after migration)

## Security Improvements

1. **Authentication Required**: All admin routes now require valid JWT token
2. **Role-Based Access**: Destructive operations require ADMIN role
3. **Error Handling**: Proper 401/403 responses for unauthorized access
4. **Audit Logging**: All operations log user ID and merchant ID
5. **Token Validation**: Tokens verified on every request

## Next Steps

1. ✅ Create default admin user: `npx tsx scripts/setup-default-merchant.ts`
2. ✅ Test endpoints: `./scripts/test-auth-endpoints.sh`
3. ⏳ Update routes to use `Merchant` instead of `BrandConfig`
4. ⏳ Add `merchantId` filtering to all queries
5. ⏳ Implement role-based restrictions for EDITOR and VIEWER roles

