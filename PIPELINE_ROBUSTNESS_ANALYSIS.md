# Pipeline Robustness Analysis

## Executive Summary

The pipeline has **strong foundations** for handling diverse user journeys, but there are **gaps** in filtering irrelevant products, especially for cross-category mismatches. The system handles vague queries well but could be more strict about product relevance.

## Current Robustness Mechanisms

### ✅ 1. Vague Query Handling

**Mechanisms:**
- **Query Categorization** (`query-categorizer.ts`): Classifies queries as `direct_search`, `indirect_search`, or `irrelevant`
- **Category Classification with Confidence** (`category-classifier.ts`): Attempts to identify categories even for vague queries
- **Follow-up Question Generation** (`followup-generator.ts`): Generates 2-3 clarifying questions for vague queries
- **Constraint Relaxation** (`search/index.ts`): Progressive relaxation when strict filters return 0 results

**How it works:**
1. Query is categorized as `indirect_search` if vague
2. System attempts category classification first (confidence >= 0.5)
3. If categories identified → proceeds with discovery
4. If unclear → generates follow-up questions
5. User answers → constraints merged → search proceeds

**Strengths:**
- ✅ Tries category classification before asking questions
- ✅ Context-aware follow-up questions
- ✅ Handles follow-up refinements intelligently

**Gaps:**
- ⚠️ Follow-up questions might not cover all edge cases
- ⚠️ No validation that follow-up answers are coherent

### ✅ 2. Different Query Types

**Supported Query Types:**
- **Discovery**: "show me blue dresses"
- **Refinement**: "make it cheaper", "in light colors"
- **Product-specific Q&A**: "Does this have pockets?"
- **Vague/Exploratory**: "something for a wedding"
- **Irrelevant**: "what's the weather?"

**Handling:**
- ✅ Dialogue routing (`router.ts`) classifies query types
- ✅ Constraint merger handles follow-ups intelligently
- ✅ Product-specific queries use different pipeline path
- ✅ Irrelevant query handler with LLM-based decision

**Strengths:**
- ✅ Comprehensive query type coverage
- ✅ Intelligent constraint merging for follow-ups
- ✅ Context-aware responses

### ⚠️ 3. Irrelevant Product Filtering

**Current Mechanisms:**

#### A. Relevance Score Checking
- **Location**: `orchestrator.ts` lines 2211-2294
- **Threshold**: `MIN_RELEVANCE_SCORE = 0.2` (lowered from 0.3)
- **Logic**: Filters products with score < 0.2

**Issue**: Threshold is **too low** - allows products with only 20% relevance

#### B. Product Type Matching
- **Location**: `orchestrator.ts` lines 2218-2262
- **Logic**: Checks if top product matches product type keywords in query
- **Keywords**: Limited set: `['jogger', 'dress', 'top', 'bottom', 'skirt', 'swimsuit', 'bikini', 'cardigan', 'sweater', 'pants', 'shorts']`

**Issues:**
- ⚠️ **Limited keyword list** - doesn't cover all product types (e.g., "towels", "perfumes", "bedding", "candles")
- ⚠️ **Only checks top product** - doesn't validate all products in results
- ⚠️ **Category mismatch not checked** - "dresses" query could return "towels" if they have similar embeddings

#### C. Age Group Filtering
- **Location**: `orchestrator.ts` lines 2178-2199
- **Logic**: Hard filters products when age group explicitly mentioned
- **Strength**: ✅ Works well for kids vs adult filtering

#### D. Constraint Matching Scores
- **Location**: `constraint-matcher.ts`
- **Logic**: Calculates weighted match scores for all constraints
- **Strength**: ✅ Comprehensive constraint matching

**Gaps:**
- ❌ **No category-level validation** - doesn't check if product category matches query intent
- ❌ **Cross-category contamination** - "dresses" query could return "towels" if embeddings are similar
- ❌ **Limited product type keywords** - missing many categories from enriched dataset

## Critical Gaps

### 1. Cross-Category Mismatch Detection

**Problem**: Query for "dresses" could return "towels" if:
- Embeddings are similar (e.g., "white dress" vs "white towel")
- Vector search finds semantic similarity
- Product type keywords don't catch it (towels not in keyword list)

**Current Protection**: Only checks limited product type keywords

**Recommendation**: Add category-level validation

### 2. Relevance Threshold Too Low

**Problem**: `MIN_RELEVANCE_SCORE = 0.2` means products with only 20% relevance are shown

**Current Behavior**: 
- Products with score >= 0.2 are considered "relevant"
- This is too permissive

**Recommendation**: Increase threshold or make it dynamic based on query type

### 3. Product Type Keyword List Incomplete

**Problem**: Only checks 11 product type keywords, but dataset has 48 categories

**Missing Keywords**: towels, perfumes, bedding, candles, jewelry, accessories, etc.

**Recommendation**: Expand keyword list or use category matching instead

### 4. No Category-Level Filtering After Vector Search

**Problem**: Vector search can return products from wrong categories if embeddings are similar

**Example**: "wedding dress" query might return "wedding candles" if they have similar semantic embeddings

**Current Protection**: Category filtering happens at SQL level, but vector search can bypass it

**Recommendation**: Post-filter vector results by category

## Recommendations

### High Priority

1. **Add Category-Level Validation**
   - After vector search, validate that returned products match query's intended category
   - Use category classification result to filter products
   - Reject products from completely different categories (e.g., "dresses" query shouldn't return "towels")

2. **Expand Product Type Keyword List**
   - Add all 48 categories to product type matching
   - Or better: use category matching instead of keyword matching

3. **Increase Relevance Threshold**
   - Raise `MIN_RELEVANCE_SCORE` from 0.2 to 0.3 or 0.35
   - Make threshold dynamic based on query confidence

4. **Post-Filter Vector Results by Category**
   - After vector search, filter results to only include products from categories identified by classifier
   - This prevents cross-category contamination

### Medium Priority

5. **Validate All Products, Not Just Top Product**
   - Currently only validates top product
   - Should validate all products in results

6. **Add Category Mismatch Detection**
   - Check if product category matches query's intended category
   - Use category classification confidence to determine strictness

7. **Improve Follow-up Question Validation**
   - Validate that follow-up answers are coherent
   - Handle cases where user provides contradictory answers

### Low Priority

8. **Add Query-Product Similarity Check**
   - Use embedding similarity as additional relevance check
   - Reject products with very low similarity scores

9. **Dynamic Threshold Based on Query Type**
   - Stricter thresholds for specific queries (e.g., "dresses")
   - More lenient for vague queries (e.g., "something elegant")

## Current Pipeline Flow for Different Scenarios

### Scenario 1: Vague Query - "something for a wedding"

**Flow:**
1. Query categorized as `indirect_search`
2. Category classification attempted → might identify "Women's Dresses"
3. If confidence >= 0.5 → proceeds with discovery
4. If confidence < 0.5 → generates follow-up questions
5. User answers → constraints merged → search proceeds

**Robustness**: ✅ **Good** - handles vague queries well

### Scenario 2: Specific Query - "blue dresses under $100"

**Flow:**
1. Query categorized as `direct_search`
2. Constraints extracted: colors=["Blue"], category="Women's Dresses", priceMaxCents=10000
3. Category classification → ["Women's Dresses"]
4. Vector search + constraint matching
5. Results filtered and ranked
6. Relevance check (score >= 0.2)
7. Product type check (limited keywords)

**Robustness**: ⚠️ **Moderate** - could return irrelevant products if:
- Similar embeddings from different categories
- Product type keywords don't match
- Relevance threshold too low

### Scenario 3: Cross-Category Contamination - "wedding dress" returns "wedding candles"

**Flow:**
1. Query: "wedding dress"
2. Category classification → ["Women's Dresses"]
3. Vector search finds "wedding candles" (similar embeddings)
4. SQL category filter applied, but if candles somehow pass...
5. Relevance check: score might be >= 0.2 (too low)
6. Product type check: "candles" not in keyword list → **FAILS TO CATCH**

**Robustness**: ❌ **Weak** - cross-category contamination not prevented

### Scenario 4: Irrelevant Query - "what's the weather?"

**Flow:**
1. Query categorized as `irrelevant`
2. Irrelevant query handler called
3. LLM determines if query could relate to catalog
4. If completely irrelevant → graceful denial
5. If could relate → redirect to products

**Robustness**: ✅ **Good** - handles irrelevant queries well

## Conclusion

**Overall Assessment**: The pipeline is **moderately robust** but has **critical gaps** in filtering irrelevant products, especially for cross-category mismatches.

**Strengths:**
- ✅ Excellent vague query handling
- ✅ Good follow-up refinement logic
- ✅ Comprehensive constraint matching
- ✅ Good irrelevant query detection

**Weaknesses:**
- ❌ Cross-category contamination not prevented
- ❌ Relevance threshold too low (0.2)
- ❌ Limited product type keyword list
- ❌ No category-level validation after vector search

**Priority Fixes:**
1. Add category-level validation after vector search
2. Expand product type keyword list or use category matching
3. Increase relevance threshold
4. Post-filter vector results by category


