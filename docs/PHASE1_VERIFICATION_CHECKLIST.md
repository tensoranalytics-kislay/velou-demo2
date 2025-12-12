# Phase 1 Verification Checklist

Use this checklist to verify Phase 1 completion. Check off items as you test them.

## Widget Package (@velou/widget)

### Structure
- [ ] `packages/@velou/widget/` directory exists
- [ ] `package.json` has correct name, version, exports
- [ ] `tsconfig.json` configured correctly
- [ ] `webpack.config.js` configured correctly
- [ ] `README.md` exists with usage examples

### Build & Compilation
- [ ] Run `cd packages/@velou/widget && npm install` - succeeds
- [ ] Run `npm run type-check` - **passes** (no TypeScript errors)
- [ ] Run `npm run build` - generates `dist/` directory
- [ ] `dist/index.js` exists (CommonJS)
- [ ] `dist/index.esm.js` exists (ES Module)
- [ ] `dist/cdn/loader.js` exists (CDN loader)
- [ ] `dist/styles/widget.css` exists (or similar)

### Imports & Exports
- [ ] Can import: `import { VelouWidget } from '@velou/widget'`
- [ ] Can import hooks: `import { useAssistantQuery, useChatPersistence, useAnalytics } from '@velou/widget'`
- [ ] Can import ApiClient: `import { WidgetApiClient } from '@velou/widget'`
- [ ] All types exported and accessible

### CDN Usage
- [ ] CDN script loads: `<script src="https://cdn.velou.ai/widget.js" data-merchant-id="..." data-api-key="..."></script>`
- [ ] Widget mounts automatically
- [ ] Can access `window.VelouWidget` global object

### Styling
- [ ] Widget CSS doesn't conflict with host page
- [ ] Widget is mobile responsive
- [ ] CSS uses encapsulated classes (`.velou-widget-*`)

---

## Widget API Routes

### Authentication
- [ ] `POST /api/widget/{merchantId}/assistant/stream` requires API key
- [ ] `GET /api/widget/{merchantId}/chat/greeting` requires API key
- [ ] `GET /api/widget/{merchantId}/chat/placeholder` requires API key
- [ ] `GET /api/widget/{merchantId}/suggestions` requires API key
- [ ] `POST /api/widget/{merchantId}/analytics/event` requires API key
- [ ] `GET /api/widget/{merchantId}/config` requires API key
- [ ] `GET /api/widget/{merchantId}/products/{productId}` requires API key

### Error Responses
- [ ] Invalid API key returns 401
- [ ] Missing API key returns 401
- [ ] Origin not in whitelist returns 403
- [ ] Rate limit exceeded returns 429

### CORS
- [ ] All responses include CORS headers
- [ ] `Access-Control-Allow-Origin` header present
- [ ] `Access-Control-Allow-Methods` includes GET, POST, OPTIONS
- [ ] `Access-Control-Allow-Headers` includes Content-Type, Authorization
- [ ] OPTIONS preflight requests handled

### Rate Limiting
- [ ] Rate limit set to 500 requests per minute per API key
- [ ] Rate limit headers present: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- [ ] Returns 429 after exceeding limit
- [ ] `Retry-After` header included

### SSE Streaming
- [ ] `/assistant/stream` returns `text/event-stream` content type
- [ ] Progress events sent as `data: {"type": "progress", ...}\n\n`
- [ ] Final response sent as `data: {"type": "response", ...}\n\n`
- [ ] Can receive multiple progress events before final response

---

## Widget Authentication

### API Key Management
- [ ] API keys can be created via admin API
- [ ] API key format: `pk_live_xxx` (public) or `sk_live_xxx` (secret)
- [ ] API key stored in `ApiKey` table
- [ ] API key can be regenerated via admin
- [ ] Old key becomes invalid after regeneration
- [ ] `isActive` flag works (inactive keys rejected)

### Origin Management
- [ ] Allowed origins stored in `allowedOrigins` array
- [ ] Can add origin via admin API
- [ ] Can remove origin via admin API
- [ ] Origin verification endpoint exists
- [ ] Invalid origin rejected with 403

---

## Admin UI - Installation Page

### Page Access
- [ ] Page accessible at `/admin/{merchantId}/integrations/installation`
- [ ] Page requires authentication
- [ ] Navigation link appears in admin sidebar

### Platform Tabs
- [ ] Shopify tab visible and functional
- [ ] WordPress tab visible and functional
- [ ] Custom Website tab visible and functional
- [ ] Wix/Squarespace tab visible and functional
- [ ] Can switch between tabs

### Code Blocks
- [ ] Code blocks display correctly
- [ ] Copy button works (copies to clipboard)
- [ ] Copy button shows "Copied!" feedback

### API Configuration
- [ ] API key displayed (read-only)
- [ ] Copy API key button works
- [ ] Regenerate key button shows confirmation
- [ ] Regenerate key works (creates new key)
- [ ] Allowed origins list displays
- [ ] Add origin input field works
- [ ] "+ Add Origin" button works
- [ ] Remove origin button works
- [ ] Verify origin button works

### Installation Status
- [ ] Last detected timestamp displays
- [ ] Widget health status displays (connected/degraded/disconnected)
- [ ] Metrics display (requests, errors, avg response time)

### Testing
- [ ] Test widget card visible
- [ ] "Open Test Page" button present
- [ ] "Reset Test Session" button present

### Troubleshooting
- [ ] Troubleshooting section visible
- [ ] FAQ items are collapsible
- [ ] Support contact link works

### Responsive Design
- [ ] Page works on mobile (test on small screen)
- [ ] Tabs work on mobile
- [ ] Code blocks readable on mobile

---

## Testing

### Widget Functionality
- [ ] Widget renders on test page
- [ ] Can send message from widget
- [ ] Message arrives at API endpoint
- [ ] Progress updates stream via SSE
- [ ] Final response appears in widget
- [ ] Product cards display correctly
- [ ] Can click "View product" on cards

### Analytics
- [ ] Analytics events tracked
- [ ] Events stored in `AnalyticsEvent` table
- [ ] Events include sessionId, merchantId, eventType

### Persistence
- [ ] Chat messages persist in localStorage
- [ ] Session ID persists in sessionStorage
- [ ] Data namespaced by merchantId

### Cross-Domain
- [ ] Session ID works across domains
- [ ] No CORS errors in browser console
- [ ] Widget works when embedded on different domain

### Error Handling
- [ ] Invalid API key shows user-friendly error
- [ ] Network errors handled gracefully
- [ ] No console errors for valid requests

---

## Code Quality

### TypeScript
- [ ] Widget code properly typed
- [ ] No `any` types (except where necessary)
- [ ] Type definitions exported

### Imports
- [ ] No unused imports
- [ ] All imports resolve correctly

### Error Handling
- [ ] Try-catch blocks in async functions
- [ ] User-friendly error messages
- [ ] No internal error details exposed

### Logging
- [ ] No sensitive data in logs
- [ ] Structured logging used
- [ ] No console.log in production code (except logger)

### Documentation
- [ ] JSDoc comments on complex functions
- [ ] README in widget package
- [ ] API route documentation

---

## Security

### Authentication
- [ ] API keys validated on every request
- [ ] Invalid keys rejected immediately
- [ ] Origin validation prevents CSRF

### CORS
- [ ] Only allowed origins can access API
- [ ] Wildcard subdomains supported
- [ ] CORS headers set correctly

### Rate Limiting
- [ ] Prevents abuse
- [ ] Per-API-key limiting
- [ ] Proper error responses

### Data Protection
- [ ] No sensitive data in error messages
- [ ] No sensitive data in logs
- [ ] MerchantId verified on all requests

---

## Manual Testing Commands

### Test Widget Package Build
```bash
cd packages/@velou/widget
npm install
npm run type-check
npm run build
ls -la dist/
```

### Test API Route (with curl)
```bash
# Get API key from admin first
API_KEY="pk_live_xxx"
MERCHANT_ID="your-merchant-id"

# Test greeting endpoint
curl -X GET "http://localhost:3000/api/widget/${MERCHANT_ID}/chat/greeting" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Origin: http://localhost:3000"

# Test assistant stream
curl -X POST "http://localhost:3000/api/widget/${MERCHANT_ID}/assistant/stream" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"sessionId":"test-123","message":"Show me dresses","pageType":"HOME"}'
```

### Test Admin Page
1. Navigate to `/admin/{merchantId}/integrations/installation`
2. Check all tabs load
3. Test copy buttons
4. Test add/remove origins
5. Test regenerate API key

---

## Issues to Fix

### Critical
- [ ] **FIXED:** Next.js 15 params handling (all routes now await params)
- [ ] **FIXED:** TypeScript error in useAnalytics.ts

### Important
- [ ] API key encryption (currently plain text)
- [ ] Real metrics calculation (currently hardcoded)
- [ ] Enhanced origin verification (currently basic)

### Nice to Have
- [ ] Test page route implementation
- [ ] Shopify connection status check
- [ ] WordPress plugin ZIP download

---

## Verification Status

**Overall:** ✅ **Ready for Testing**

All core functionality is implemented. Remaining work is enhancements and production hardening.

**Next Steps:**
1. Run manual tests using checklist above
2. Fix any issues found during testing
3. Implement remaining TODOs (encryption, metrics, etc.)
4. Deploy to staging environment
5. Perform end-to-end testing


