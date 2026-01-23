# Enhanced Query Flow Diagnosis & Fixes

## Problem Summary

The enhanced query text was not being preserved across follow-up queries. Specifically:
- Step 3: "cotton instead" → enhanced: "navy cotton dresses" ✅
- Step 4: "mini instead" → enhanced: "navy mini dresses" ❌ (lost "cotton")
- Step 5: "size 6 instead" → enhanced: "navy dresses size 6" ❌ (lost "cotton" and "mini")

## Root Causes Identified

### 1. **Async State Update Not Awaited**
- **Issue**: `updateState()` was called with `.catch()` (fire-and-forget), so the state wasn't guaranteed to be persisted before the next query
- **Fix**: Changed to `await updateState()` to ensure persistence

### 2. **State Replacement Instead of Merging**
- **Issue**: `updateState()` replaces the entire `memory` object, and we were spreading `conversationState.memory` which was read at the start (potentially stale)
- **Fix**: Changed to use `updateMemory()` which properly reads current state from database and merges

### 3. **Stale State Being Passed**
- **Issue**: The orchestrator was reading `lastEnhancedQuery` from `input.conversationState` which was passed in at the start, potentially before the previous query's state update completed
- **Fix**: Modified orchestrator to read `lastEnhancedQuery` directly from the database using `getState()` to ensure we always have the latest value

### 4. **Enhanced Query Not Returned in Result**
- **Issue**: The enhanced query was stored but not returned in the result, so test scripts couldn't use it
- **Fix**: Added `enhancedQuery` field to `LoveshackfancyQueryResult` and `AssistantQueryResult` types and return values

## Fixes Applied

### 1. Orchestrator (`src/lib/loveshackfancy/orchestrator.ts`)

**a) Read Enhanced Query from Database:**
```typescript
// CRITICAL: Read from database to ensure we have the latest enhanced query
if (input.merchantId && input.sessionId) {
  try {
    const latestState = await getState(input.merchantId, input.sessionId);
    if (latestState.memory?.lastEnhancedQuery) {
      previousEnhancedQuery = latestState.memory.lastEnhancedQuery;
    }
  } catch (err) {
    // Fallback to passed-in state
  }
}
```

**b) Use `updateMemory` Instead of `updateState`:**
```typescript
// Use updateMemory which properly merges with existing memory
await updateMemory(input.merchantId, input.sessionId, {
  lastEnhancedQuery: queryToStore,
  lastCategories: topCategories && topCategories.length > 0 ? topCategories : undefined,
  lastClassificationConstraints: { ... },
});
```

**c) Return Enhanced Query in Result:**
```typescript
const result: LoveshackfancyQueryResult = {
  // ... other fields
  enhancedQuery: queryToStore, // Return the enhanced query so callers can use it
};
```

### 2. AssistantService (`src/lib/services/AssistantService.ts`)

**Pass Through Enhanced Query:**
```typescript
return {
  // ... other fields
  enhancedQuery: result.enhancedQuery, // Pass through the enhanced query
};
```

### 3. Test Script (`test-constraint-merger-followups.ts`)

**Read State from Database:**
```typescript
// CRITICAL: Read the latest state from the database
const currentState = await getState(merchantId, sessionId);
const result = await handleAssistantQuery(merchantId, {
  message: query,
  sessionId,
  conversationState: currentState, // Use state from database
});
```

## Current Status

✅ **Fixed:**
- Enhanced query is now read from database (ensures latest value)
- State updates are awaited (ensures persistence)
- State updates use proper merging (prevents data loss)
- Enhanced query is returned in result (enables proper chaining)

⚠️ **Still Investigating:**
- The constraint merger is still receiving "navy dresses" instead of "navy cotton dresses" in some cases
- This suggests either:
  1. The database update is not completing before the next read
  2. There's a transaction isolation issue
  3. The constraint merger prompt needs further refinement to better preserve all attributes

## Next Steps

1. **Add More Logging**: Log when we read from database vs passed-in state, and what value we get
2. **Verify Database Updates**: Add logging to confirm `updateMemory` is actually updating the database
3. **Test Transaction Isolation**: Check if there's a race condition between update and read
4. **Refine Constraint Merger Prompt**: Ensure Rule 12 (verification step) is working correctly to preserve all attributes

## Testing

Run the diagnostic script:
```bash
npx tsx diagnose-enhanced-query.ts
```

Run the constraint merger test:
```bash
npx tsx test-constraint-merger-followups.ts
```

Look for:
- `previousQuery` should be the enhanced query from the previous step
- `enhancedQueryText` should preserve all previously mentioned attributes
- State should show `lastEnhancedQuery` updated after each step
