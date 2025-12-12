# Phase 0 Verification Checklist

## Database

- [x] Schema has Merchant, MerchantUser, ApiKey, ReviewConfig, AnalyticsEvent
- [ ] Product, MerchRule, ConversationEvent have merchantId
- [ ] Migration script handles existing data
- [ ] Can query sample data: npx prisma studio

## Authentication

- [ ] POST /api/admin/auth/login works (returns accessToken + refreshToken)
- [ ] JWT can be decoded and verified
- [ ] POST /api/admin/auth/refresh works (returns new token pair)
- [ ] GET /api/admin/auth/me returns current user (with valid JWT)
- [ ] 401 returned when JWT invalid/missing
- [ ] 403 returned when merchantId mismatch
- [ ] Passwords hashed with bcryptjs (not stored in plain text)

## Services Layer

- [ ] MerchantService methods exist and work
- [ ] CatalogService methods exist and work
- [ ] SearchService wraps existing searchProducts
- [ ] AssistantService wraps orchestrator
- [ ] AnalyticsService methods exist
- [ ] IntegrationService methods stubbed out
- [ ] Services accept merchantId as first parameter
- [ ] Error handling in place

## Refactoring - Orchestrator

- [ ] src/lib/llm/orchestrator/flows/ directory created
- [ ] discovery.ts, pdp.ts, pending.ts, productQa.ts exist
- [ ] helpers.ts exists with shared utilities
- [ ] index.ts still exports handleAssistantQuery
- [ ] All flows work identically (no behavior changes)
- [ ] File sizes reasonable (~400, 350, 300, 280, 200, 100 lines)

## Refactoring - Search

- [ ] src/lib/search/ranking/, filtering/, query/ directories exist
- [ ] dbRankedSearch.ts, attributes.ts, relaxation.ts exist
- [ ] shopifyRanking.ts exists (new file)
- [ ] weights.ts exists with configuration
- [ ] searchProducts() still returns same results (test with same query)
- [ ] File sizes reasonable (~500, 250, 200, 150, 50, 30, 150 lines)

## Testing

- [ ] Existing unit tests still pass
- [ ] No console errors during npm run dev
- [ ] Can run npm run build without errors
- [ ] Chat still works (test with a query on / page)
- [ ] Admin dashboard still accessible (if exists)

## Code Quality

- [ ] No unused imports
- [ ] JSDoc comments on services
- [ ] TypeScript strict mode (if enabled)
- [ ] No console.error or warning messages in logs

## Environment

- [ ] .env has JWT_SECRET and REFRESH_TOKEN_SECRET
- [ ] .env.example updated with new variables
- [ ] No hardcoded secrets in code


