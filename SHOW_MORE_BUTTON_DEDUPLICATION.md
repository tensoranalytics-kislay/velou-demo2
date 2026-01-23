# Show More Button Deduplication Implementation

## Overview
Implemented deduplication logic for the "show more" button that appears after each reply with product recommendations. The button now excludes products already shown in the conversation and returns different products on each click.

## Implementation Details

### Flow
1. **User clicks "Show more" button** → `onActionClick(actionId)` is called
2. **ChatPanel** → Finds action label and calls `handleSendMessage(actionLabel, undefined, undefined, actionId)`
3. **AssistantService** → Detects `action.type === 'show_more'` and sets `messageToProcess = 'show more'`
4. **Orchestrator** → Detects "show more" request and handles it with deduplication

### Detection Logic
The orchestrator detects "show more" requests via:
- **Message patterns**: `"show more"`, `"more"`, `"next"`, contains `"show more"`, `"more options"`, or `"more products"`
- **Action ID**: If `actionId` includes `"show_more"` (for button clicks)

### Deduplication Process

1. **Load Conversation State**:
   - Reads latest state from database to get:
     - `lastRankedProductIds`: Full ranked list from original query
     - `lastRankCursor`: Current cursor position
     - `shownProductIds`: All products already shown

2. **Filter Products**:
   - Gets candidates from `lastRankedProductIds` starting at `lastRankCursor`
   - Creates a `Set` from `shownProductIds` for O(1) lookup
   - Filters out any products in the shown set
   - Takes next 4 products

3. **Update State**:
   - Marks new products as shown using `appendShownProducts()`
   - Advances cursor using `advanceRankCursor()`

4. **Return Results**:
   - Returns product cards for the new batch
   - Includes "show more" action if more products are available

### Code Changes

#### 1. Orchestrator (`src/lib/loveshackfancy/orchestrator.ts`)
- Added `actionId?: string` to `LoveshackfancyQueryInput` type
- Added "show more" handler (Step 2) that:
  - Loads conversation state from database
  - Filters out shown products
  - Returns next batch
  - Updates state

#### 2. AssistantService (`src/lib/services/AssistantService.ts`)
- Passes `actionId` to orchestrator for better detection

### Key Features

✅ **Deduplication**: Uses `Set` for efficient O(1) lookup of shown product IDs  
✅ **Cursor-based pagination**: Maintains cursor position across multiple clicks  
✅ **State persistence**: All shown products stored in database  
✅ **Early return**: Avoids re-running full query pipeline  
✅ **Multiple detection methods**: Works via message text or actionId  
✅ **Error handling**: Falls back gracefully if state loading fails

### Example Flow

```
Initial Query: "show me dresses"
→ Returns: [Product1, Product2, Product3, Product4]
→ Stores: lastRankedProductIds = [P1, P2, P3, P4, P5, P6, P7, P8, ...]
          shownProductIds = [P1, P2, P3, P4]
          lastRankCursor = 4

User clicks "Show more"
→ Handler detects "show more"
→ Gets candidates: [P5, P6, P7, P8, ...]
→ Filters out shown: [P5, P6, P7, P8] (none are in shownProductIds)
→ Returns: [Product5, Product6, Product7, Product8]
→ Updates: shownProductIds = [P1, P2, P3, P4, P5, P6, P7, P8]
           lastRankCursor = 8

User clicks "Show more" again
→ Gets candidates: [P9, P10, P11, P12, ...]
→ Filters out shown: [P9, P10, P11, P12] (none are in shownProductIds)
→ Returns: [Product9, Product10, Product11, Product12]
→ Updates: shownProductIds = [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12]
           lastRankCursor = 12
```

### Testing Recommendations

1. **Basic test**: Click "show more" after initial results, verify no duplicates
2. **Multiple clicks**: Click "show more" multiple times, verify no duplicates across all clicks
3. **New search**: Start a new search, verify "show more" works independently
4. **Edge cases**:
   - All products already shown (should return empty with message)
   - No ranked products stored (should fall through to normal flow)
   - State loading failure (should use input state as fallback)
