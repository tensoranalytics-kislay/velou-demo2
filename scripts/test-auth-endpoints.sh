#!/bin/bash

# Test script for JWT authentication endpoints
# Usage: ./scripts/test-auth-endpoints.sh [base_url]
# Example: ./scripts/test-auth-endpoints.sh http://localhost:3000

BASE_URL="${1:-http://localhost:3000}"

echo "🧪 Testing JWT Authentication Endpoints"
echo "Base URL: $BASE_URL"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Login
echo "1️⃣  Testing POST /api/admin/auth/login"
echo "----------------------------------------"

LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@velou.local",
    "password": "admin123"
  }')

echo "Response: $LOGIN_RESPONSE"
echo ""

# Extract tokens
ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
REFRESH_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"refreshToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
  echo -e "${RED}❌ Login failed - no access token received${NC}"
  echo "Please check:"
  echo "  1. Server is running"
  echo "  2. Default admin user exists (run: npx tsx scripts/setup-default-merchant.ts)"
  echo "  3. Email/password are correct"
  exit 1
fi

echo -e "${GREEN}✅ Login successful${NC}"
echo "Access Token: ${ACCESS_TOKEN:0:50}..."
echo "Refresh Token: ${REFRESH_TOKEN:0:50}..."
echo ""

# Test 2: Get current user
echo "2️⃣  Testing GET /api/admin/auth/me"
echo "----------------------------------------"

ME_RESPONSE=$(curl -s -X GET "$BASE_URL/api/admin/auth/me" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

echo "Response: $ME_RESPONSE"
echo ""

if echo "$ME_RESPONSE" | grep -q '"user"'; then
  echo -e "${GREEN}✅ Get current user successful${NC}"
else
  echo -e "${RED}❌ Get current user failed${NC}"
fi
echo ""

# Test 3: Refresh token
echo "3️⃣  Testing POST /api/admin/auth/refresh"
echo "----------------------------------------"

REFRESH_RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}")

echo "Response: $REFRESH_RESPONSE"
echo ""

NEW_ACCESS_TOKEN=$(echo $REFRESH_RESPONSE | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$NEW_ACCESS_TOKEN" ]; then
  echo -e "${RED}❌ Token refresh failed${NC}"
else
  echo -e "${GREEN}✅ Token refresh successful${NC}"
  echo "New Access Token: ${NEW_ACCESS_TOKEN:0:50}..."
fi
echo ""

# Test 4: Test protected route (products)
echo "4️⃣  Testing GET /api/admin/products (protected route)"
echo "----------------------------------------"

PRODUCTS_RESPONSE=$(curl -s -X GET "$BASE_URL/api/admin/products" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

echo "Response: $PRODUCTS_RESPONSE"
echo ""

if echo "$PRODUCTS_RESPONSE" | grep -q '"products"'; then
  echo -e "${GREEN}✅ Protected route access successful${NC}"
else
  echo -e "${RED}❌ Protected route access failed${NC}"
fi
echo ""

# Test 5: Test without token (should fail)
echo "5️⃣  Testing GET /api/admin/products without token (should fail)"
echo "----------------------------------------"

UNAUTH_RESPONSE=$(curl -s -X GET "$BASE_URL/api/admin/products")

echo "Response: $UNAUTH_RESPONSE"
echo ""

if echo "$UNAUTH_RESPONSE" | grep -q '"error"'; then
  echo -e "${GREEN}✅ Unauthorized access correctly rejected${NC}"
else
  echo -e "${RED}❌ Unauthorized access was not rejected${NC}"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ All tests completed${NC}"
echo ""
echo "Next steps:"
echo "  1. If any tests failed, check server logs"
echo "  2. Verify JWT_SECRET and REFRESH_TOKEN_SECRET are set in .env"
echo "  3. Ensure default admin user exists"


