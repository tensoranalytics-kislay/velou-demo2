# Plan vs Implementation Analysis

## Summary: Plan NOT Fully Implemented ❌

The pipeline from the plan has **NOT** been fully implemented. The current code still uses the **OLD pipeline structure** with redundant code still present.

## Detailed Comparison

### ✅ Implemented (from plan)

1. **Post-category gender filtering** - Lines 1505-1542 ✅
   - BUT: Only runs inside `if (shouldRunCategoryClassification)` block
   - **BUG**: Doesn't run when category classification happens early (line 1185)

2. **Progressive relaxation targets 4 results** - ✅
   - Modified in `constraint-ranker.ts`

3. **Gender/category/ageGroup never relaxed** - ✅
   - Implemented in `constraint-ranker.ts`

### ❌ NOT Implemented (still using old pipeline)

1. **Gender extraction FIRST (before category classification)** - ❌
   - **Plan says**: Extract gender at line ~1268 (before category classification)
   - **Current code**: Gender resolved at line 1779 (AFTER category classification at line 1185)
   - **Impact**: Category classification happens without gender context, leading to wrong categories

2. **AgeGroup extraction FIRST** - ❌
   - **Plan says**: Extract ageGroup before category classification
   - **Current code**: AgeGroup extracted from classification result (after classification)

3. **Filter categories BEFORE classification** - ❌
   - **Plan says**: Filter allowed categories by gender before classification (line ~1297)
   - **Current code**: `buildAllowedCategoriesForClassifier` is called inside classifier, not in orchestrator before classification

4. **Dictionary refinement BEFORE retrieval** - ❌
   - **Plan says**: Move refinement to before retrieval (around line 1964)
   - **Current code**: Refinement at line 2474 (AFTER retrieval at line 1935)
   - **Impact**: Wastes ~15 seconds (refinement runs after products are retrieved)

5. **Remove gender clarification check** - ❌
   - **Plan says**: Remove lines 1827-1962
   - **Current code**: Still exists at lines 1773-1900 (~127 lines)
   - **Impact**: Unnecessary complexity, gender should be extracted early

6. **Remove explicit mentions extraction** - ❌
   - **Plan says**: Remove lines 2411-2474 (~63 lines)
   - **Current code**: Still exists at lines 2362-2414 (~52 lines)
   - **Impact**: Redundant, LLM already extracts this

7. **Pass gender/ageGroup to retrieval as HARD filters** - ❌
   - **Plan says**: Pass `resolvedGender` and `resolvedAgeGroup` to `multiViewRetrieval`
   - **Current code**: `multiViewRetrieval` call at line 1935 doesn't pass gender/ageGroup
   - **Impact**: Gender filtering happens in SQL but not as explicit parameters

8. **Simplify constraint merging** - ⚠️ Partially
   - **Plan says**: Simplify ~270 lines to ~100
   - **Current code**: Still has complex merging logic

## Redundant Code Still Present

### 1. Gender Clarification Check (~127 lines)
- **Location**: Lines 1773-1900
- **Plan says**: Remove entirely
- **Status**: Still present
- **Reason**: Gender should be extracted early, making this unnecessary

### 2. Explicit Mentions Extraction (~52 lines)
- **Location**: Lines 2362-2414
- **Plan says**: Remove (LLM already extracts this)
- **Status**: Still present
- **Reason**: Redundant with LLM classification

### 3. Dictionary Refinement After Retrieval
- **Location**: Lines 2466-2520
- **Plan says**: Move to before retrieval
- **Status**: Still after retrieval
- **Reason**: Performance optimization not applied

### 4. Multiple Category Classifications
- **Plan says**: Remove 5-6 redundant calls
- **Status**: Need to verify if all removed

## Current Pipeline Flow (Actual)

```
1. Safety Check
2. Follow-up Handling
3. Category Classification (line 1185) ← Happens FIRST
4. Query Classification (line 1222)
5. Gender Resolution (line 1779) ← Happens AFTER category classification
6. Gender Clarification Check (line 1773) ← Still present
7. Retrieval (line 1935)
8. Dictionary Refinement (line 2474) ← AFTER retrieval
9. Ranking
10. Explicit Mentions Extraction (line 2362) ← Still present
```

## Planned Pipeline Flow (from plan)

```
1. Safety Check
2. Follow-up Handling
3. Extract Gender FIRST (before category)
4. Extract AgeGroup FIRST (before category)
5. Filter Categories BEFORE Classification
6. Category Classification (once, with gender-filtered categories)
7. Filter Categories AFTER Classification
8. Query Classification
9. Dictionary Refinement BEFORE Retrieval ← Key optimization
10. Retrieval (with gender/ageGroup as HARD filters)
11. Ranking
```

## Critical Issues from Not Following Plan

1. **Gender filtering bug**: Post-category gender filtering doesn't run when category classification happens early
2. **Wrong categories**: "Mens-jeans" returned for "women" queries because gender isn't extracted first
3. **Performance**: Dictionary refinement after retrieval wastes ~15 seconds
4. **Code bloat**: ~179 lines of redundant code still present (gender clarification + explicit mentions)

## Recommendations

1. **IMMEDIATE**: Implement the plan fully
2. **Priority 1**: Extract gender/ageGroup FIRST (before category classification)
3. **Priority 2**: Move dictionary refinement BEFORE retrieval
4. **Priority 3**: Remove gender clarification check and explicit mentions extraction
5. **Priority 4**: Fix post-category gender filtering to always run

## Files That Need Changes

- `src/lib/loveshackfancy/orchestrator.ts` - Major refactoring needed
- `src/lib/loveshackfancy/category-classifier.ts` - Accept pre-filtered categories
- `src/lib/loveshackfancy/retrieval.ts` - Accept gender/ageGroup as parameters
- `src/lib/loveshackfancy/constraint-refiner.ts` - Already excludes ageGroup ✅
