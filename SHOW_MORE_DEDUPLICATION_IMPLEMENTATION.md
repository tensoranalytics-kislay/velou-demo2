# Show More Button Deduplication Implementation

## Overview
Implemented deduplication logic for the "show more" button to ensure that products already shown in the conversation are excluded from subsequent "show more" results.

## Requirements
- ✅ Deduplicate products already shown in the conversation
- ✅ Show different products (not duplicates) when "show more" is clicked
- ✅ Maintain cursor position for pagination
- ✅ Update shown products list after each "show more" click

## Implementation Details

### Location
**File**: `src/lib/loveshackfancy/orchestrator.ts`

### Handler Placement
The "show more" handler is placed **early in the orchestrator flow** (Step 2), before follow-up handling, to avoid re-running the full query pipeline.

### Detection Logic
The handler detects "show more" requests by checking if the message matches any of these patterns:
- `"show more"`
- `"more"`
- `"next"`
- Contains `"show more"`, `"more options"`, or `"more products"`

### State Management
1. **Loads latest conversation state** from database to get:
   - `lastRankedProductIds`: Full list of ranked products from the original query
   - `lastRankCursor`: Current cursor position (how many products have been shown)
   - `shownProductIds`: All product IDs that have been shown in the conversation

2. **Filters products**:
   - Gets candidates from `lastRankedProductIds` starting at `lastRankCursor`
   - Filters out any products in `shownProductIds` (already shown)
   - Takes the next 4 products

3. **Updates state**:
   - Marks new products as shown using `appendShownProducts()`
   - Advances cursor using `advanceRankCursor()`

### Code Flow

```typescript
// 1. Load conversation state from database
const conversationState = await getState(merchantId, sessionId);

// 2. Check if "show more" request
if (isShowMore && conversationState.lastRankedProductIds.length > 0) {
  // 3. Get next batch, excluding already shown
  const candidateIds = conversationState.lastRankedProductIds.slice(conversationState.lastRankCursor);
  const shownProductIdsSet = new Set(conversationState.shownProductIds || []);
  const nextBatchIds = candidateIds.filter(id => !shownProductIdsSet.has(id)).slice(0, 4);
  
  // 4. Load and return products
  const products = await loadFashionProducts(nextBatchIds, merchantId);
  
  // 5. Update state
  await appendShownProducts(merchantId, sessionId, nextBatchIds);
  await advanceRankCursor(merchantId, sessionId, nextBatchIds.length);
  
  // 6. Check if more products available
  const hasMore = remainingAfterCursor.length > 0;
  
  // 7. Return results with "show more" action if applicable
  return { productCards, actions: hasMore ? [{ type: 'show_more' }] : [] };
}
```

### Key Features

1. **Deduplication**: Uses `Set` for O(1) lookup of shown product IDs
2. **Cursor-based pagination**: Maintains cursor position to track progress through ranked list
3. **State persistence**: All shown products are stored in database, so deduplication works across multiple "show more" clicks
4. **Early return**: Handler returns immediately if "show more" is detected, avoiding full query re-execution

### Integration Points

- **Initial Query**: When products are first shown, they're stored via `appendShownProducts()` in `AssistantService.ts`
- **Show More Click**: Handler reads from database state, filters, and updates state
- **Multiple Clicks**: Each "show more" click advances the cursor and excludes all previously shown products

### Error Handling

- If state loading fails, falls back to `input.conversationState`
- If no products found, returns empty result with message
- If product loading fails, falls through to normal query flow

## Testing Recommendations

1. **Test basic "show more"**: Click "show more" after initial results, verify no duplicates
2. **Test multiple clicks**: Click "show more" multiple times, verify no duplicates across all clicks
3. **Test with new search**: Start a new search, verify "show more" works independently
4. **Test edge cases**: 
   - All products already shown (should return empty with message)
   - No ranked products stored (should fall through to normal flow)
   - State loading failure (should use input state as fallback)
