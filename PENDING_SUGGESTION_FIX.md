# Pending Suggestion Override Fix

## Problem

The system was bypassing LLM + search on follow-ups when a pending suggestion existed. For example:

1. User: "Smart casual outfit for office in summer"
   - Creates pending suggestion (outfit bundle)
   - Returns 0 products, `noExactMatch: true`

2. User: "please show some tshirts only"
   - System detected `hasPendingSuggestion: true`
   - Called `pending_suggestion_confirmed` 
   - **NO** `inferIntentAndConstraintsWithLlm` call
   - **NO** `runDiscoveryFlow`
   - **NO** `searchProducts` call
   - Just returned the 5 candidates from previous pending suggestion (outfit items, not tshirts)

## Root Cause

The pending suggestion confirmation logic was too aggressive:
- `isAffirmativeResponse()` was matching "please show" as affirmative
- `looksLikeNewQuery()` didn't catch "only/just + category" patterns
- Hard override detection was missing

## Fix

### 1. Added `isHardOverride()` Function

Detects patterns that should bypass pending suggestions:
- "only tshirts", "just skirts", "show me tops"
- "instead", "switch to", "filter to", "change to"
- "not X, just Y" patterns

```typescript
export function isHardOverride(message: string): boolean {
  // Regex patterns for hard overrides
  // Category keyword detection
  // Returns true if message contains override signals
}
```

### 2. Updated Pending Suggestion Logic

**Before:**
```typescript
if (isAffirmativeResponse(normalized)) {
  // Confirm pending suggestion
}
```

**After:**
```typescript
// Check for hard override FIRST (before affirmative check)
if (isHardOverride(input.message)) {
  // Override pending suggestion, proceed to LLM + search
} else if (isAffirmativeResponse(normalized)) {
  // Only confirm if clear affirmative AND not hard override
}
```

### 3. Hard Override Patterns

The function detects:
- `/\bonly\s+(t-?shirts?|tees?|skirts?|...)\b/i`
- `/\bjust\s+(t-?shirts?|tees?|skirts?|...)\b/i`
- `/\bshow\s+me\s+(t-?shirts?|tees?|skirts?|...)\b/i`
- `/\binstead\b/i`
- `/\bswitch\s+to\b/i`
- `/\bnot\s+\w+,\s*(just|only)\s+\w+/i`
- `/\bfilter\s+to\b/i`
- `/\bchange\s+to\b/i`

Plus fallback: if message contains "only/just" + category keyword, treat as override.

## Expected Behavior Now

1. User: "Smart casual outfit for office in summer"
   - Creates pending suggestion
   - Returns 0 products

2. User: "please show some tshirts only"
   - `isHardOverride()` returns `true`
   - Logs: `pending_suggestion_overridden_hard`
   - **Calls** `inferIntentAndConstraintsWithLlm`
   - **Calls** `runDiscoveryFlow`
   - **Calls** `searchProducts` with category="Tops" or productTypes=["tshirt"]
   - Returns actual tshirts, not outfit items

## Testing

Test cases that should now work:
- ✅ "please show some tshirts only" → overrides, searches for tshirts
- ✅ "just skirts" → overrides, searches for skirts
- ✅ "only black tees" → overrides, searches for black tshirts
- ✅ "show me tops instead" → overrides, searches for tops
- ✅ "yes show me" → confirms pending suggestion (no override)
- ✅ "okay" → confirms pending suggestion (no override)

## Files Changed

1. `src/lib/llm/orchestrator/intent.ts`
   - Added `isHardOverride()` function

2. `src/lib/llm/orchestrator/index.ts`
   - Updated pending suggestion logic to check hard override first
   - Imported `isHardOverride`

## Verification

- ✅ TypeScript compilation: PASSED (except for known Prisma.sql issues in search/index.ts)
- ✅ Logic flow: Hard override checked before affirmative response
- ✅ Pattern matching: Covers "only/just/show me + category" patterns


