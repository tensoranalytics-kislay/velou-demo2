# Diagnosis Items - Implementation Status

## ✅ All Diagnosis Items Addressed

### A. Zero-result failures (taxonomy + synonym mismatch)
**Status**: ✅ FIXED

**Problem**: 
- LLM inferred categories like "shirts & tops" or "graphic t shirt" that don't match DB category strings
- Synonym sets didn't include spaced form "t shirt", so hard/keyword filters missed valid items

**Solution**:
- ✅ Added "t shirt" (spaced) to TSHIRT synonyms (not just expandedLeafCats)
- ✅ Expanded all category synonym maps with CSV-grounded variants
- ✅ Implemented rescue stage that handles 0 results gracefully
- ✅ Rescue stage performs closest-match search and asks clarifying questions

**Files Modified**:
- `src/lib/search/canonicalize.ts` - Added "t shirt" to synonyms, expanded all maps
- `src/lib/llm/orchestrator/index.ts` - Added rescue stage

### B. Attribute filtering brittleness
**Status**: ✅ FIXED

**Problem**:
- `matchesAttributeFilters()` was too strict, causing `afterAttributeFilter: 0` repeatedly
- Ontology normalization didn't map user terms to exact stored values

**Solution**:
- ✅ Added `materialMatches()` for substring matching (e.g., "cotton" matches "75% Cotton 21% Polyester")
- ✅ Added `colorMatches()` for strict color validation against catalog ontology
- ✅ Invalid colors are dropped as hard filters (not used to filter out products)
- ✅ Materials use substring matching for better recall

**Files Modified**:
- `src/lib/search/index.ts` - Enhanced `matchesAttributeFilters()` with robust matching

### C. Soft query used only for scoring
**Status**: ✅ FIXED

**Problem**:
- `constraints.query` was only used for soft scoring
- If category resolution failed or synonyms incomplete, user intent words weren't used for recall

**Solution**:
- ✅ Added `expandedKeywords` field to `SearchConstraints`
- ✅ LLM extracts `expandedKeywords` with synonym-expanded recall keywords
- ✅ `buildBroadWhereFilters()` merges `expandedKeywords` with canonical synonyms
- ✅ Keywords used in SQL keyword filters for hard prefiltering (not just scoring)

**Files Modified**:
- `src/lib/search/types.ts` - Added `expandedKeywords` field
- `src/lib/search/index.ts` - Uses `expandedKeywords` in keyword filters
- `src/lib/llm/orchestrator/intent.ts` - Extracts `expandedKeywords` from LLM

### D. Pending suggestion too narrowly gated
**Status**: ✅ FIXED

**Problem**:
- Pending suggestion only triggered if: relaxed, >=8 candidates, and category not dropped
- Many "almost there" cases skipped pending suggestion and jumped to "no products"

**Solution**:
- ✅ Implemented rescue stage as alternative flow when strict search yields 0
- ✅ Rescue stage mentions closest matches and asks questions (no cards yet)
- ✅ Added confirm-to-show handling for "yes/show/anything" responses
- ✅ User can confirm pending suggestions or proceed with closest matches

**Files Modified**:
- `src/lib/llm/orchestrator/index.ts` - Added rescue stage and confirm-to-show handling

### E. Ranked search SQL misconfigured
**Status**: ⚠️ PARTIALLY ADDRESSED (Graceful Fallback)

**Problem**:
- Raw SQL search expects `search_vector` column that doesn't exist
- Repeated fallback to Prisma, wiping out relevance

**Solution**:
- ✅ Feature flag `ENABLE_RAW_RANKED_SEARCH` implemented (defaults to `false`)
- ✅ Graceful fallback to Prisma when raw SQL fails or flag is disabled
- ✅ System works without `search_vector` column
- ⚠️ Full-text ranking requires DB migration (optional)

**Migration Required** (optional):
```sql
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS search_vector tsvector;
UPDATE "Product" SET search_vector = to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(category,''));
CREATE INDEX IF NOT EXISTS product_search_vector_gin ON "Product" USING GIN(search_vector);
```

**Files Modified**:
- `src/lib/search/index.ts` - Added feature flag and graceful fallback

### F. No de-dup by title
**Status**: ✅ FIXED

**Problem**:
- No deduplication stage before building cards
- Same title (case-insensitive) could appear multiple times

**Solution**:
- ✅ Added `deduplicateProductCards()` function
- ✅ Removes duplicates by title (case-insensitive)
- ✅ Avoids near-duplicates (same title + same color + same price)
- ✅ Applied in `runDiscoveryFlow()` before returning cards

**Files Modified**:
- `src/lib/llm/orchestrator/cards.ts` - Added deduplication function
- `src/lib/llm/orchestrator/index.ts` - Applied deduplication

## 📊 Implementation Checklist

### Core Requirements
- ✅ User query → structured constraints + expanded keywords (synonyms)
- ✅ Expand into all DB-relevant variants (e.g., "t shirt", "t-shirt", "tee")
- ✅ Use dedicated columns only for dedicated filters
- ✅ Strip colors/price from text query
- ✅ Strict search (category + hard attributes + expanded keywords)
- ✅ If 0 results → Closest-match rescue search
- ✅ Drop only least reliable constraints first (occasion/season/style words)
- ✅ Retrieve top 3–6 closest items
- ✅ Mention closest matches in text + ask engaging follow-up (no cards yet)
- ✅ Follow-up handling (more details → re-search, "yes/show" → show closest matches)
- ✅ Card de-dup & diversity (remove duplicates, prefer variety)

### Synonym Dictionary
- ✅ T-shirt / tee: ["t shirt","t-shirt","tshirt","tee","tees","graphic tee",...]
- ✅ Shirts & tops: ["shirt","shirts","top","tops","blouse","button down","oxford",...]
- ✅ Jeans / denim: ["jeans","jean","denim","skinny jeans","straight jeans",...]
- ✅ Pants / trousers: ["pants","trouser","slacks","chinos","joggers",...]
- ✅ Shorts: ["shorts","bermuda","denim shorts","bike shorts"]
- ✅ Skirts: ["skirt","skirts","mini skirt","midi skirt","maxi skirt"]
- ✅ Dresses: ["dress","dresses","gown","shift dress","wrap dress",...]
- ✅ Sweaters / knits: ["sweater","sweaters","knit","pullover","cardigan"]
- ✅ Hoodies / sweatshirts: ["hoodie","hoodies","sweatshirt","fleece"]
- ✅ Jackets / outerwear: ["jacket","coat","blazer","puffer","parka"]
- ✅ Shoes: ["shoes","sneakers","trainers","boots","sandals"]
- ✅ Accessories: ["bag","handbag","tote","backpack","belt","hat","cap"]

### Color Mapping
- ✅ Color groups defined (black, white, blue, green, red, yellow, pink, purple, orange, brown, gray, multi)
- ✅ `mapColorToCatalog()` validates against catalog ontology
- ✅ Invalid colors dropped as hard filters

### Material Mapping
- ✅ Material groups defined (cotton, denim, linen, polyester, spandex, viscose, wool, leather)
- ✅ `mapMaterialToCatalog()` returns keywords for substring matching

### Fit / Occasion / Season
- ✅ Fit keywords: slim, skinny, straight, relaxed, regular, oversized, boyfriend, mom, wide-leg, flare, bootcut, cropped, high-rise, mid-rise, low-rise
- ✅ Occasion keywords: office/work, smart casual, casual, formal, party, vacation, lounge, gym
- ✅ Season keywords: summer, winter, fall, spring, all-season

## 🎯 Test Coverage

### Unit Tests Added
- ✅ Synonym expansion variants generation
- ✅ Color/material mapping utilities
- ✅ Card deduplication
- ✅ Confirm-to-show detection patterns

### Manual Testing Recommended
1. **Synonym matching**: Query "tees" should return products with "t shirt", "t-shirt", "tshirt" in title
2. **Rescue stage**: Query with strict filters yielding 0 results should trigger rescue and show closest matches
3. **Confirm-to-show**: With pending suggestion, "yes" or "show" should display saved products
4. **Color validation**: Query with non-ontology color should drop color filter but still search
5. **Material substring**: Query "cotton" should match "75% Cotton 21% Polyester" products
6. **Card de-dup**: Products with same title (different case) should only appear once

## 📝 Notes

- All V2 prompts are integrated and enabled by default (`useV2 = true`)
- System gracefully falls back to V1 or rule-based logic when LLM fails
- Build passes with no TypeScript errors
- All diagnosis items addressed except optional `search_vector` migration

