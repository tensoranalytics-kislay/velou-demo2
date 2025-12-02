# Product Discovery Pipeline Rebuild - Implementation Summary

## ✅ Completed Implementation

### A) Synonym Expansion Improvements
**Status**: ✅ COMPLETE

- ✅ Added `generateSynonymVariants()` utility to auto-generate spaced/hyphen/concatenated variants
- ✅ Added `expandKeywordsForSearch()` for comprehensive keyword expansion
- ✅ Updated `CATEGORY_SYNONYMS` to include "t shirt" (spaced) in synonyms (not just expandedLeafCats)
- ✅ Added HOODIE category with comprehensive synonyms
- ✅ Expanded all category synonym maps with user-specified variants:
  - TSHIRT: includes "t shirt", "t-shirt", "tshirt", "tee", "tees", "graphic tee", etc.
  - TOP: includes "button down", "oxford", "camisole", "tank top", "sleeveless top"
  - JEANS: includes "denim pants", "straight jeans", "mom jeans", "boyfriend jeans"
  - PANTS: includes "joggers", "cargo pants", "work pants"
  - SHORTS: includes "bike shorts"
  - DRESS: includes "shift dress", "wrap dress"
  - SWEATER: includes "knit", "knits", "crewneck sweater"
  - JACKET: includes "puffer", "shacket"
  - SHOES: includes "trainers"
  - ACCESSORY: comprehensive bag/hat/scarf/jewelry terms

**Files Modified**:
- `src/lib/search/canonicalize.ts`

### B) Column-Safe Constraint Extraction
**Status**: ✅ COMPLETE

- ✅ Updated `INTENT_AND_CONSTRAINTS_PROMPT_V2` with column-safe rules
- ✅ Added `expandedKeywords` field to `SearchConstraints` type
- ✅ Implemented color mapping via `mapColorToCatalog()` - validates against catalog ontology
- ✅ Implemented material mapping via `mapMaterialToCatalog()` - returns substring keywords
- ✅ Updated `inferIntentAndConstraintsWithLlm()` to:
  - Use V2 prompt (configurable via `useV2` flag)
  - Extract `expandedKeywords` from LLM response
  - Map colors to catalog ontology (drops invalid colors)
  - Map materials for substring matching
  - Strip colors/price from query text

**Files Modified**:
- `src/lib/llm/prompts.ts` - Added V2 prompt and schema
- `src/lib/llm/orchestrator/intent.ts` - Updated to use V2 and map colors/materials
- `src/lib/search/types.ts` - Added `expandedKeywords` field
- `src/lib/search/canonicalize.ts` - Added color/material mapping utilities

### C) No-Results Rescue Stage
**Status**: ✅ COMPLETE

- ✅ Implemented rescue stage in `runDiscoveryFlow()` when `candidates.length === 0`
- ✅ Calls `CLOSEST_MATCH_RESCUE_PLAN_PROMPT` to generate up to 3 broadened searches
- ✅ Executes rescue searches sequentially using `searchProductsRelaxed()`
- ✅ Collects top 5 closest candidates
- ✅ Calls `NO_RESULTS_REPLY_PROMPT_V2` to generate friendly response
- ✅ Response mentions up to 3 closest products by title (no cards yet)
- ✅ Asks 1-2 clarifying questions in brand voice
- ✅ Returns `noExactMatch: true` with empty `productCards`

**Files Modified**:
- `src/lib/llm/orchestrator/index.ts` - Added rescue stage logic
- `src/lib/llm/prompts.ts` - Added rescue plan and no-results reply prompts

### D) Confirm-to-Show Handling
**Status**: ✅ COMPLETE

- ✅ Updated `CONTEXT_GATEKEEPER_PROMPT_V2` to support `confirm_to_show` threadType
- ✅ Updated `ContextGatekeeperResult` type to include `'confirm_to_show'`
- ✅ Updated `callContextGatekeeper()` to:
  - Accept `pendingSuggestion` parameter
  - Use V2 prompt (configurable)
  - Return `confirm_to_show` when pending suggestion exists and message is confirmation-like
- ✅ Updated `handleAssistantQuery()` to:
  - Check for pure confirmation keywords before calling `inferIntentAndConstraints`
  - Run `runPendingSuggestionFlow()` when `confirm_to_show` detected
  - Handle "yes", "show", "anything", "whatever works", "nothing else" keywords

**Files Modified**:
- `src/lib/llm/orchestrator/intent.ts` - Updated context gatekeeper
- `src/lib/llm/orchestrator/index.ts` - Added confirm_to_show handling

### E) Attribute Filter Robustness
**Status**: ✅ COMPLETE

- ✅ Added `materialMatches()` function for substring matching (e.g., "cotton" matches "75% Cotton 21% Polyester")
- ✅ Added `colorMatches()` function for strict color validation against catalog ontology
- ✅ Updated `matchesAttributeFilters()` to:
  - Use `materialMatches()` for fabrics and materials
  - Use `colorMatches()` for colors (validates against ontology)
  - Accept `colorOntology` parameter for validation
- ✅ Updated all calls to `matchesAttributeFilters()` to pass color ontology

**Files Modified**:
- `src/lib/search/index.ts` - Enhanced attribute filtering

### F) Card Deduplication
**Status**: ✅ COMPLETE

- ✅ Added `deduplicateProductCards()` function in `cards.ts`
- ✅ Removes duplicates by title (case-insensitive)
- ✅ Avoids near-duplicates (same title + same color + same price)
- ✅ Applied in `runDiscoveryFlow()` before returning cards

**Files Modified**:
- `src/lib/llm/orchestrator/cards.ts` - Added deduplication function
- `src/lib/llm/orchestrator/index.ts` - Applied deduplication

### G) Expanded Keywords Usage
**Status**: ✅ COMPLETE

- ✅ Updated `buildBroadWhereFilters()` to use `expandedKeywords` if provided
- ✅ Merges `expandedKeywords` with canonical synonym terms
- ✅ Uses expanded keywords in keyword filters for SQL prefiltering
- ✅ Falls back to canonical synonyms if `expandedKeywords` not provided

**Files Modified**:
- `src/lib/search/index.ts` - Updated to use expandedKeywords

## 🔍 Diagnosis Items - Status Check

### A. Zero-result failures (taxonomy + synonym mismatch)
**Status**: ✅ FIXED
- ✅ Added "t shirt" (spaced) to TSHIRT synonyms
- ✅ Rescue stage implemented to handle 0 results gracefully
- ✅ Expanded synonym maps cover CSV vocabulary

### B. Attribute filtering brittleness
**Status**: ✅ FIXED
- ✅ Substring matching for materials/fabrics
- ✅ Strict color validation against ontology
- ✅ Invalid colors are dropped (not used as hard filters)

### C. Soft query used only for scoring
**Status**: ✅ FIXED
- ✅ `expandedKeywords` are used in keyword filters for SQL prefiltering
- ✅ Keywords merged with canonical synonyms for comprehensive recall

### D. Pending suggestion too narrowly gated
**Status**: ✅ FIXED
- ✅ Confirm-to-show handling allows "yes/show/anything" to proceed
- ✅ Rescue stage provides alternative flow when pending suggestion doesn't trigger

### E. Ranked search SQL misconfigured
**Status**: ⚠️ PARTIALLY ADDRESSED
- ✅ Feature flag `ENABLE_RAW_RANKED_SEARCH` implemented (defaults to false)
- ✅ Graceful fallback to Prisma when raw SQL fails
- ⚠️ `search_vector` column not created (requires DB migration)
- **Note**: System works with Prisma fallback, but full-text ranking requires migration

### F. No de-dup by title
**Status**: ✅ FIXED
- ✅ `deduplicateProductCards()` implemented and applied

## 📋 Remaining Work

### Unit Tests (TODO #8)
**Status**: ⚠️ PENDING

Need to add tests for:
- Synonym expansion variants generation
- Color/material mapping utilities
- Rescue stage execution
- Confirm-to-show detection
- Card deduplication
- Expanded keywords usage in search

**Recommended Test File**: `tests/discovery_pipeline_v2.test.ts`

### Database Migration (Optional)
**Status**: ⚠️ OPTIONAL

To enable full-text ranking:
```sql
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS search_vector tsvector;
UPDATE "Product" SET search_vector = to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(category,''));
CREATE INDEX IF NOT EXISTS product_search_vector_gin ON "Product" USING GIN(search_vector);
```

## 🎯 Implementation vs Requirements

### ✅ Fully Implemented
1. Synonym expansion with CSV-grounded variants
2. Column-safe constraint extraction (colors/materials from dedicated fields)
3. No-results rescue stage with closest matches
4. Confirm-to-show handling
5. Attribute filter robustness
6. Card deduplication
7. Expanded keywords usage in search

### ⚠️ Partially Implemented
1. **Context Gatekeeper V2**: Prompt added, integrated, but could be enhanced with better pending suggestion detection
2. **Intent V2**: Prompt added and integrated, but V1 fallback still available

### 📝 Notes
- All new prompts (PROMPT 0-5) are available and integrated
- V2 prompts are enabled by default (`useV2 = true`) but can be toggled
- System gracefully falls back to V1 or rule-based logic when LLM fails
- Build passes with no TypeScript errors
- All diagnosis items addressed except search_vector migration (optional)

## 🚀 Next Steps

1. **Add Unit Tests** (TODO #8)
   - Create `tests/discovery_pipeline_v2.test.ts`
   - Test synonym expansion, color/material mapping, rescue stage, de-dup

2. **Optional: Database Migration**
   - Add `search_vector` column and GIN index for full-text ranking
   - Set `ENABLE_RAW_RANKED_SEARCH=true` in environment

3. **Manual Testing**
   - Test "t shirt" queries return products
   - Test rescue stage with strict filters yielding 0 results
   - Test confirm-to-show with "yes/show/anything"
   - Test card deduplication with duplicate titles


