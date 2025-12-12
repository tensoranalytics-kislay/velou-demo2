# JWT Authentication Implementation

## Overview

JWT-based authentication system for the Velou Shopping Assistant admin portal. Implements secure token-based authentication with access and refresh tokens.

## Architecture

### Token Types

1. **Access Token** (7 days expiry)
   - Contains: userId, merchantId, role
   - Used for: API authentication
   - Stored: Client-side (localStorage/sessionStorage)

2. **Refresh Token** (30 days expiry)
   - Contains: userId, merchantId
   - Used for: Obtaining new access tokens
   - Stored: Client-side (localStorage/sessionStorage)

### Security Features

- ✅ Separate secrets for access and refresh tokens
- ✅ Token expiration (7d access, 30d refresh)
- ✅ Role-based access control (ADMIN, EDITOR, VIEWER)
- ✅ Multi-tenant isolation (merchantId verification)
- ✅ Password hashing with bcrypt (12 salt rounds)
- ✅ Constant-time password comparison
- ✅ No password logging
- ✅ Token verification on every request

## Environment Variables

Add these to your `.env` file:

```env
# JWT Authentication
# Generate secrets with: openssl rand -base64 32
# Must be at least 32 characters long
JWT_SECRET="your-32-character-or-longer-secret-here"
REFRESH_TOKEN_SECRET="your-32-character-or-longer-refresh-secret-here"
```

### Generating Secrets

```bash
# Generate JWT_SECRET
openssl rand -base64 32

# Generate REFRESH_TOKEN_SECRET
openssl rand -base64 32
```

## API Endpoints

### POST /api/admin/auth/login

Authenticate a user and receive tokens.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "role": "ADMIN",
    "merchantId": "merchant-123",
    "merchant": {
      "id": "merchant-123",
      "name": "Acme Corporation",
      "slug": "acme-corp"
    }
  }
}
```

**Errors:**
- `400`: Invalid request body
- `401`: Invalid credentials
- `403`: Account inactive

### POST /api/admin/auth/logout

Logout endpoint (client removes tokens).

**Request Headers:**
```
Authorization: Bearer <accessToken>
```

**Response (200):**
```json
{
  "message": "Logged out successfully"
}
```

### POST /api/admin/auth/refresh

Refresh access token using refresh token.

**Request:**
```json
{
  "refreshToken": "eyJhbGc..."
}
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc..."
}
```

**Errors:**
- `400`: Invalid request body
- `401`: Invalid or expired refresh token
- `403`: Account inactive

### GET /api/admin/auth/me

Get current authenticated user information.

**Request Headers:**
```
Authorization: Bearer <accessToken>
```

**Response (200):**
```json
{
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "role": "ADMIN",
    "merchantId": "merchant-123",
    "merchant": {
      "id": "merchant-123",
      "name": "Acme Corporation",
      "slug": "acme-corp",
      "brandName": "Acme"
    },
    "isActive": true,
    "lastLogin": "2024-12-06T12:00:00Z",
    "createdAt": "2024-12-01T10:00:00Z"
  }
}
```

**Errors:**
- `401`: Unauthorized
- `403`: Account inactive
- `404`: User not found

## Usage in API Routes

### Basic Authentication

```typescript
import { requireAuth } from '@/middleware/auth';
import { createAuthErrorResponse } from '@/middleware/auth';

export async function GET(request: Request) {
  try {
    const session = await requireAuth(request);
    // session.userId, session.merchantId, session.role available
    // Proceed with request...
  } catch (error) {
    return createAuthErrorResponse(error);
  }
}
```

### Merchant-Specific Authentication

```typescript
import { requireMerchantAuth } from '@/middleware/auth';

export async function GET(
  request: Request,
  { params }: { params: { merchantId: string } }
) {
  try {
    const session = await requireMerchantAuth(request, params.merchantId);
    // User belongs to this merchant
    // Proceed with request...
  } catch (error) {
    return createAuthErrorResponse(error);
  }
}
```

### Role-Based Access Control

```typescript
import { requireRole } from '@/middleware/auth';

export async function DELETE(
  request: Request,
  { params }: { params: { merchantId: string } }
) {
  try {
    // Only ADMIN and EDITOR can delete
    const session = await requireRole(request, params.merchantId, ['ADMIN', 'EDITOR']);
    // User has required role
    // Proceed with deletion...
  } catch (error) {
    return createAuthErrorResponse(error);
  }
}
```

## Client-Side Usage

### Login

```typescript
const response = await fetch('/api/admin/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});

const { accessToken, refreshToken, user } = await response.json();

// Store tokens
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', refreshToken);
```

### Authenticated Requests

```typescript
const accessToken = localStorage.getItem('accessToken');

const response = await fetch('/api/admin/merchant/profile', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
  },
});
```

### Token Refresh

```typescript
const refreshToken = localStorage.getItem('refreshToken');

const response = await fetch('/api/admin/auth/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ refreshToken }),
});

const { accessToken, refreshToken: newRefreshToken } = await response.json();

// Update tokens
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', newRefreshToken);
```

## File Structure

```
src/
├── lib/
│   └── auth/
│       ├── jwt.ts          # Token generation and verification
│       ├── password.ts      # Password hashing and verification
│       └── session.ts       # Session data extraction
├── middleware/
│   └── auth.ts             # Auth middleware functions
└── app/
    └── api/
        └── admin/
            └── auth/
                ├── login/
                │   └── route.ts
                ├── logout/
                │   └── route.ts
                ├── refresh/
                │   └── route.ts
                └── me/
                    └── route.ts
```

## Security Best Practices

1. **Token Storage**
   - Store tokens in `localStorage` or `sessionStorage`
   - Consider `httpOnly` cookies for production (requires additional setup)

2. **HTTPS**
   - Always use HTTPS in production
   - Tokens are transmitted in headers (secure with HTTPS)

3. **Token Rotation**
   - Refresh tokens are rotated on each refresh
   - Old refresh tokens become invalid

4. **Password Security**
   - Minimum 8 characters (enforced)
   - Hashed with bcrypt (12 salt rounds)
   - Never logged or exposed

5. **Error Handling**
   - Generic error messages (don't reveal if user exists)
   - Constant-time password comparison
   - No sensitive data in logs

## Testing

### Manual Testing

1. **Login:**
   ```bash
   curl -X POST http://localhost:3000/api/admin/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@example.com","password":"password123"}'
   ```

2. **Get Current User:**
   ```bash
   curl -X GET http://localhost:3000/api/admin/auth/me \
     -H "Authorization: Bearer <accessToken>"
   ```

3. **Refresh Token:**
   ```bash
   curl -X POST http://localhost:3000/api/admin/auth/refresh \
     -H "Content-Type: application/json" \
     -d '{"refreshToken":"<refreshToken>"}'
   ```

## Troubleshooting

### "JWT_SECRET must be set and at least 32 characters long"

- Ensure `.env` file has `JWT_SECRET` and `REFRESH_TOKEN_SECRET`
- Generate new secrets: `openssl rand -base64 32`
- Restart the development server

### "Invalid or expired token"

- Token may have expired (7 days for access, 30 days for refresh)
- Use refresh endpoint to get new tokens
- Re-login if refresh token expired

### "Access denied: user does not belong to this merchant"

- User's `merchantId` doesn't match the requested merchant
- Verify user belongs to the correct merchant

## Next Steps

- [ ] Implement token blacklisting (optional, for enhanced security)
- [ ] Add rate limiting to login endpoint
- [ ] Implement password reset flow
- [ ] Add 2FA support (future)
- [ ] Add OAuth2 support (future)


