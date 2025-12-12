# Widget API Routes

## Overview

Widget-specific API routes that use API key authentication (not JWT). These routes are designed for cross-origin requests from merchant websites embedding the Velou widget.

## Authentication

All widget routes require:
- **API Key** in `Authorization: Bearer pk_live_xxx` header
- **Origin Validation** - Origin must be in API key's `allowedOrigins` array
- **Rate Limiting** - 500 requests per minute per API key

## CORS

All routes return appropriate CORS headers:
- `Access-Control-Allow-Origin: {origin}` (if origin is allowed)
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`
- `Access-Control-Allow-Credentials: true`

## Routes

### 1. POST /api/widget/{merchantId}/assistant/stream

Streams assistant responses via Server-Sent Events (SSE).

**Request:**
```json
{
  "sessionId": "session-123",
  "pageType": "HOME",
  "message": "Show me summer dresses",
  "history": [...],
  "productContextId": "prod-456",
  "conversationContext": {...},
  "pendingSuggestion": {...}
}
```

**Response:** SSE stream with:
- `data: {"type": "progress", "stage": "searching", "progress": 50, "queryType": "discovery"}`
- `data: {"type": "response", "response": {...}}`

### 2. GET /api/widget/{merchantId}/chat/greeting

Returns dataset-aware greeting text.

**Response:**
```json
{
  "greeting": "Hey there, I'm Acme's shopping assistant..."
}
```

### 3. GET /api/widget/{merchantId}/chat/placeholder

Returns dataset-aware placeholder for input field.

**Response:**
```json
{
  "placeholder": "Ask for summer dresses under $100..."
}
```

### 4. GET /api/widget/{merchantId}/suggestions?lastMessage=...

Returns context-aware suggested prompts.

**Query Params:**
- `lastMessage` (optional) - Last user message for follow-up suggestions

**Response:**
```json
{
  "suggestions": ["summer dresses under $100", "casual outfits", "beach wear"]
}
```

### 5. POST /api/widget/{merchantId}/analytics/event

Records analytics events (fire-and-forget).

**Request:**
```json
{
  "sessionId": "session-123",
  "eventType": "product_click",
  "payload": {
    "productId": "prod-456",
    "productUrl": "https://..."
  },
  "userDevice": "Mozilla/5.0...",
  "userPage": "https://acme.com/products",
  "userReferer": "https://google.com"
}
```

**Response:**
```json
{
  "success": true
}
```

### 6. GET /api/widget/{merchantId}/config

Returns widget configuration (branding, colors, etc.).

**Response:**
```json
{
  "merchantName": "Acme Corporation",
  "brandColors": {
    "primary": "#D61F2B",
    "accent": "#FEEEED",
    "background": "#ffffff",
    "surface": "#fff7f7",
    "border": "#ffe4e6"
  },
  "voiceInstructions": "...",
  "toneFormal": 5,
  "tonePlayful": 5,
  "logoUrl": "https://..."
}
```

### 7. GET /api/widget/{merchantId}/products/{productId}

Returns full product details.

**Response:**
```json
{
  "id": "prod-123",
  "title": "Summer Dress",
  "description": "...",
  "imageUrl": "https://...",
  "priceCents": 9900,
  "salePriceCents": 7900,
  "currency": "USD",
  "category": "Dresses",
  "subcategory": "Summer",
  "brand": "Acme",
  "attributes": {...},
  "stockStatus": "in_stock",
  "productUrl": "https://...",
  "reviewScore": 4.5,
  "reviewCount": 120
}
```

## Error Responses

All routes return consistent error formats:

**401 Unauthorized:**
```json
{
  "error": "Missing or invalid Authorization header. Expected: Bearer <api-key>"
}
```

**403 Forbidden:**
```json
{
  "error": "Origin not allowed. Please check your API key configuration."
}
```

**429 Too Many Requests:**
```json
{
  "error": "Rate limit exceeded. Please try again later."
}
```

**500 Internal Server Error:**
```json
{
  "error": "Failed to process request"
}
```

## Security Features

1. **API Key Validation**
   - Keys must start with `pk_live_` or `sk_live_`
   - Keys must be active
   - Keys must belong to the merchantId in the URL

2. **Origin Validation**
   - Supports exact domain matching
   - Supports wildcard subdomains (`*.example.com`)
   - Prevents CSRF attacks

3. **Rate Limiting**
   - 500 requests per minute per API key
   - Uses Upstash Redis (with in-memory fallback)
   - Returns proper 429 responses with headers

4. **Request Logging**
   - Logs endpoint, merchantId, statusCode, duration
   - No sensitive data (no full tokens, no passwords)
   - Structured logging for monitoring

## Testing

Example curl request:

```bash
curl -X POST https://api.velou.ai/api/widget/acme-corp/assistant/stream \
  -H "Authorization: Bearer pk_live_xxx" \
  -H "Content-Type: application/json" \
  -H "Origin: https://acme.com" \
  -d '{
    "sessionId": "test-session",
    "pageType": "HOME",
    "message": "Show me dresses"
  }'
```


