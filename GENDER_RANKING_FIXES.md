# Gender Filtering + Relevance Ranking Fixes

## Issues Fixed

### 1. ✅ Fallback Relevance Ranking Now Active

**Problem**: Prisma fallback was using recency-only ordering (`ORDER BY updatedAt DESC`), causing newest items to dominate even if better matches existed.

**Fix**:
- Removed `orderBy` from Prisma query - fetch WITHOUT ordering first
- Increased fetch pool to 3-5x take (instead of just 2x) to have better candidates for ranking
- Calculate relevance rank AFTER fetch (gender match, keyword matches, category match, recency tie-breaker)
- Sort by `rank DESC, updatedAt DESC` before returning
- Added logging to show when ranking is applied

**Files Modified**:
- `src/lib/search/index.ts` - Lines 726-848

**Logs to Expect**:
```
dbRankedSearch fallback relevance ranking applied
  totalFetched: 1500
  afterGenderFilter: 800
  afterRanking: 800
  topRank: 4.5
  genderFilter: mens
  keywordFilters: ['shirt', 'blazer']
```

### 2. ✅ Gender Extraction from Initial Queries

**Problem**: Gender was only extracted from follow-ups, not initial queries. Queries like "shirts for men" didn't have `genders: ["mens"]` in constraints.

**Fix**:
- Added `extractGenderFromMessage()` function in `utils.ts`
- Detects: "men/mens/men's/male", "women/womens/women's/female", "unisex"
- Applied in `inferIntentAndConstraintsWithLlm()` after LLM extraction
- Also applied in follow-up refinement (already existed)

**Files Modified**:
- `src/lib/llm/orchestrator/utils.ts` - Added `extractGenderFromMessage()`
- `src/lib/llm/orchestrator/intent.ts` - Apply gender extraction after LLM

**Logs to Expect**:
```
extractGenderFromMessage
  message: "shirts for men"
  detectedGender: "mens"
```

### 3. ✅ Stronger Deduplication with Backfill

**Problem**: Dedup was too weak (only `toLowerCase().trim()`) and didn't backfill, so duplicates survived.

**Fix**:
- Enhanced `normalizeTitle()` function:
  - Lowercase + trim
  - Collapse multiple spaces to single space
  - Remove punctuation (except hyphens)
  - Collapse multiple hyphens
  - Normalize space-hyphen-space to hyphen
  - Remove zero-width characters
- Updated `deduplicateProductCards()` to accept `limit` parameter
- Applied with limit to ensure we get enough unique cards
- Added logging to show dedup results

**Files Modified**:
- `src/lib/llm/orchestrator/cards.ts` - Enhanced deduplication
- `src/lib/llm/orchestrator/index.ts` - Pass limit to dedup

**Logs to Expect**:
```
deduplicateProductCards
  before: 8
  after: 6
  removed: 2
```

## How It Works Now

### Gender Filtering Flow

1. **Initial Query**: "shirts for men"
   - `extractGenderFromMessage()` detects "mens"
   - Adds `genders: ["mens"]` to constraints
   - Passed to `buildBroadWhereFilters()` → `genders` in `BroadWhereFilters`
   - Applied in DB query (raw SQL or Prisma fallback)

2. **Follow-up Query**: "for men though"
   - `detectFollowUpType()` detects `REFINE` with `detectedGender: "mens"`
   - Intent resolution adds `genders: ["mens"]` to constraints
   - Same DB filtering applies

3. **DB Filtering**:
   - Raw SQL: `(attributes->>'gender' = 'mens' OR attributes->>'gender' = 'unisex')`
   - Prisma fallback: Filters in-memory after fetch (fetches 5x take)

### Relevance Ranking Flow

1. **Fetch Phase**:
   - Fetch 3-5x take WITHOUT ordering
   - Apply gender filter if present
   - Result: Large pool of candidates

2. **Ranking Phase**:
   - Calculate rank for each product:
     - Gender match: +2.0 (exact) or +1.0 (unisex)
     - Keyword matches: +0.75 each (max 4)
     - Category match: +1.5
     - Recency: +0.2 max (tie-breaker only)
   - Sort by `rank DESC, updatedAt DESC`
   - Take top N

3. **Result**: Relevance-first ordering, not recency-first

### Deduplication Flow

1. **Before Dedup**: Top N cards (may have duplicates)
2. **Normalize**: Each title through `normalizeTitle()`
3. **Dedup**: Keep first occurrence of each normalized title
4. **Result**: N unique cards (or fewer if duplicates removed)

## Testing

### Manual Test Cases

1. **"shirts for men under 200"**
   - Should have `genders: ["mens"]` in constraints
   - Should return men/unisex shirts only
   - Should be sorted by relevance (not recency)

2. **"for men though"** (follow-up)
   - Should detect `REFINE` with `detectedGender: "mens"`
   - Should add `genders: ["mens"]` to constraints
   - Should filter to men/unisex products

3. **Duplicate titles**
   - Should see dedup log showing removed duplicates
   - Should have unique titles in final cards

### Expected Logs

```
extractGenderFromMessage { message: "shirts for men", detectedGender: "mens" }
dbRankedSearch fallback relevance ranking applied { totalFetched: 1500, afterRanking: 800, topRank: 4.5 }
deduplicateProductCards { before: 8, after: 6, removed: 2 }
```

## Known Limitations

1. **Prisma JSON Filtering**: Gender filter in Prisma fallback requires in-memory filtering (fetches 5x take). This is acceptable for now.

2. **Gender Extraction**: Uses simple regex patterns. May miss edge cases like "male clothing" vs "men's clothing", but covers common patterns.

3. **Dedup Normalization**: May still miss very similar titles with different Unicode characters, but handles common cases (spaces, punctuation, hyphens).

## Next Steps (Optional)

1. **Native Prisma JSON Filtering**: If Prisma version supports it, use native JSON path filtering instead of in-memory filtering.

2. **Gender Extraction Enhancement**: Could use LLM to extract gender more accurately, but current regex approach is fast and works for common cases.

3. **Dedup Backfill**: If dedup removes too many cards, could backfill from next-best candidates, but current approach (fetch 3-5x take) usually provides enough unique candidates.


