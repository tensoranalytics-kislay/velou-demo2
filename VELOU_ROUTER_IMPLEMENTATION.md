# VelouRouter LLM-Based Routing Implementation

## Overview

Implemented an LLM-based router system (`VelouRouter`) that intelligently decides how to handle user messages when pending suggestions exist. This replaces the previous regex-based hard override detection with a more sophisticated, context-aware approach.

## Problem Solved

Previously, the system was bypassing LLM + search on follow-ups when a pending suggestion existed. For example:
- User: "Smart casual outfit for office in summer" → Creates pending suggestion
- User: "please show some tshirts only" → System confirmed pending suggestion instead of searching for tshirts

## Solution

### 1. New Router Prompt (`VELOU_ROUTER_PROMPT`)

Added a strict system prompt that enforces conservative pending suggestion confirmation:
- **R1**: Pending suggestions may be confirmed ONLY if message is pure confirmation ("yes", "ok", "show me those")
- **R2**: If message contains ANY product type, action MUST be "override_search" or "refine_search"
- **R3**: Words "only", "just", "instead", "switch to" are ALWAYS hard overrides if followed by product type
- **R4**: New category with `keep_previous_constraints=true` unless user explicitly resets
- **R5**: Modifiers without category → "refine_search", keep category

### 2. Router Function (`callVelouRouter`)

Created `src/lib/llm/orchestrator/intent-router.ts` with:
- LLM call using structured output (JSON schema)
- Fallback to rule-based detection for mock provider
- Error handling with graceful fallback

### 3. Integration into Orchestrator

Updated `src/lib/llm/orchestrator/index.ts` to:
- Call VelouRouter when pending suggestion exists
- Handle router actions:
  - `confirm_pending_suggestion` → Run pending suggestion flow
  - `override_search` → Clear pending, merge constraints, run LLM + search
  - `refine_search` → Merge router refinements, run LLM + search
  - `non_product_chat` → Return clarifying response

## Expected Behavior

### Example: "just show some tshirts"

**Before:**
- `pending_suggestion_confirmed` → Returns outfit items

**After:**
- VelouRouter detects: `action: "override_search"`, `new_category: "tshirts"`
- Logs: `pending_suggestion_overridden_by_router`
- Calls `inferIntentAndConstraintsWithLlm`
- Calls `runDiscoveryFlow`
- Calls `searchProducts` with category="Tops" or productTypes=["tshirt"]
- Returns actual tshirts

### Example: "yes show me"

**Before & After:**
- VelouRouter detects: `action: "confirm_pending_suggestion"`
- Logs: `pending_suggestion_confirmed`
- Returns pending suggestion candidates

## Files Changed

1. **`src/lib/llm/prompts.ts`**
   - Added `VELOU_ROUTER_PROMPT`
   - Added `VELOU_ROUTER_JSON_SCHEMA`

2. **`src/lib/llm/orchestrator/intent-router.ts`** (NEW)
   - `callVelouRouter()` function
   - `VelouRouterResult` type

3. **`src/lib/llm/orchestrator/index.ts`**
   - Integrated VelouRouter into pending suggestion handling
   - Replaced regex-based logic with LLM-based routing

## Router Output Schema

```typescript
{
  action: "confirm_pending_suggestion" | "refine_search" | "override_search" | "non_product_chat",
  new_category: string | null,
  refinements: {
    colors?: string[] | null,
    fabrics?: string[] | null,
    materials?: string[] | null,
    seasons?: string[] | null,
    occasions?: string[] | null,
    sizes?: string[] | null,
    fit?: string | null,
    priceMinCents?: number | null,
    priceMaxCents?: number | null,
    style_keywords?: string[] | null
  },
  keep_previous_constraints: boolean,
  reason: string
}
```

## Benefits

1. **Context-Aware**: LLM understands conversation context, not just keywords
2. **Conservative**: Strict rules prevent false confirmations
3. **Flexible**: Handles edge cases better than regex
4. **Maintainable**: Centralized routing logic
5. **Fallback-Safe**: Rule-based fallback for mock provider and errors

## Testing

Test cases that should now work:
- ✅ "please show some tshirts only" → `override_search`, searches for tshirts
- ✅ "just skirts" → `override_search`, searches for skirts
- ✅ "only black tees" → `override_search`, searches for black tshirts
- ✅ "show me tops instead" → `override_search`, searches for tops
- ✅ "yes show me" → `confirm_pending_suggestion`
- ✅ "okay" → `confirm_pending_suggestion`
- ✅ "maybe in linen" → `refine_search`, adds fabric constraint

## Verification

- ✅ TypeScript compilation: PASSED (orchestrator files)
- ✅ Router function: Implemented with fallback
- ✅ Integration: Complete in `handleAssistantQuery`
- ✅ Prompt: Added with strict rules

## Next Steps

1. Test with real queries to verify router decisions
2. Monitor router logs to ensure correct routing
3. Fine-tune prompt if needed based on edge cases
4. Consider caching router results for identical queries

