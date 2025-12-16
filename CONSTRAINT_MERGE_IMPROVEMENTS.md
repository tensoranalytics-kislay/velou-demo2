# Constraint Merging Logic Improvements

## Summary

Comprehensive improvements to the constraint merging logic in the L'Occitane orchestrator to handle refinement queries more intelligently and reliably.

## Key Improvements

### 1. Enhanced Router Prompt (`src/lib/loccitane/prompts.ts`)

**Changes:**
- Added explicit guidance for determining `replace: true` vs `replace: false`
- Added decision rules with examples for common edge cases
- Clarified that only mentioned constraint types should be replaced when `replace: true` is set
- Added recognition patterns for replacement language ("instead", "not that", "actually", "nvm", etc.)

**Impact:**
- Router now makes more accurate decisions about whether to replace or add constraints
- Better handling of ambiguous cases like "lavender ones instead" after showing shea butter products

### 2. Improved Constraint Merging Logic (`src/lib/loccitane/orchestrator.ts`)

**Changes:**

#### a. Enhanced Initial Merge Logic (lines ~745-880)
- Added logic to check `refinePatch.replace` flag BEFORE merging previous constraints
- When `replace: true`, skip merging previous values for constraint types present in `refinePatch`
- Ensures previous constraints are preserved when appropriate (e.g., productTypes preserved when only ingredients are replaced)

#### b. Improved refinePatch Application (lines ~882-936)
- Added handling for empty arrays (skip empty patches)
- Enhanced deduplication logic for add operations
- Clarified that refinePatch takes precedence over classification constraints

#### c. Robust Intersection Logic for Concept Search (lines ~1165-1275)
- **Major Fix**: Changed from union-based to intersection-based prioritization for multiple constraints
- When multiple constraint types are specified (e.g., productTypes AND ingredients), find products that match ALL types (intersection)
- Within each constraint type, use union (product matches if it matches ANY value of that type)
- Example: "lavender hand creams" → products must match BOTH "lavender" ingredient AND "hand cream" product type

**Previous Logic (Flawed):**
```typescript
// Old: Used union for all matches, leading to irrelevant results
constraintMatchSets.push(productIds); // For each matching constraint
conceptMatchedIds = union of all constraintMatchSets; // Wrong!
```

**New Logic (Correct):**
```typescript
// New: Intersection across constraint types, union within each type
// Group matches by type → union within type → intersect across types
matchesByType.productTypes → union → setsToIntersect[0]
matchesByType.ingredients → union → setsToIntersect[1]
conceptMatchedIds = intersection(setsToIntersect); // Correct!
```

**Impact:**
- Fixes issue where "lavender ones instead" (after "shea butter hand creams") would find products matching either lavender OR hand cream, instead of lavender AND hand cream
- More precise results for multi-constraint queries

### 3. Comprehensive Test Suite (`tests/loccitane/constraint_merging.test.ts`)

**Added:**
- Conceptual tests documenting expected behavior for replace vs add scenarios
- Edge case tests (empty patches, multiple refinements, classification vs refinePatch conflicts)
- Intersection logic tests demonstrating correct behavior

**Coverage:**
- Replace logic: ingredients, product types, multiple constraint types
- Add logic: size constraints, price constraints, ingredient combinations
- Complex scenarios: sequential refinements, partial replacements
- Classification vs refinePatch conflicts

## Example Scenarios

### Scenario 1: Ingredient Replacement
**Query 1:** "shea butter hand creams"
- `productTypes: ['Hand Cream']`, `ingredients: ['shea_butter']`

**Query 2:** "lavender ones instead"
- Router extracts: `refinePatch: { ingredients: ['lavender'], replace: true }`
- **Result:** `productTypes: ['Hand Cream']` (preserved), `ingredients: ['lavender']` (replaced)
- **Concept Search:** Intersection of "Hand Cream" AND "lavender" matches

### Scenario 2: Adding Constraints
**Query 1:** "hand creams"
- `productTypes: ['Hand Cream']`

**Query 2:** "travel size please"
- Router extracts: `refinePatch: { size: 'travel', replace: false }`
- **Result:** `productTypes: ['Hand Cream']` (preserved), `size: 'travel'` (added)
- **Filtering:** Products filtered by size keywords in title/description

### Scenario 3: Multiple Constraint Types
**Query 1:** "anti-aging serums"
- `productTypes: ['Serum']`, `concerns: ['Aging']`

**Query 2:** "for sensitive skin instead"
- Router extracts: `refinePatch: { skinTypes: ['Sensitive'], replace: true }`
- **Result:** `productTypes: ['Serum']` (preserved), `concerns: ['Aging']` (preserved), `skinTypes: ['Sensitive']` (replaced)
- **Concept Search:** Intersection of "Serum" AND "Aging" AND "Sensitive"

## Technical Details

### Constraint Merge Order

1. **Initial Merge** (lines ~770-880):
   - Merge `lastClassificationConstraints` with `classification.constraints`
   - Skip constraint types that `refinePatch` will replace (if `replace: true`)
   - Combine/merge array constraints appropriately

2. **refinePatch Application** (lines ~882-936):
   - Apply `refinePatch` constraints (takes precedence over classification)
   - If `replace: true`: overwrite constraint values
   - If `replace: false`: combine with existing values (deduplicate)

3. **Concept Search Prioritization** (lines ~1165-1275):
   - Group concept matches by constraint type
   - Union within each type (product matches if it matches ANY value of that type)
   - Intersect across types (product must match ALL constraint types)

### Normalization

- Product types normalized via `normalizeProductType()` (handles variations like "Hand Cream" vs "hand cream")
- Ingredients normalized via `normalizeIngredient()` (handles canonical forms like "lavender" → "lavender_oil")
- Collections normalized to lowercase trimmed strings

## Testing

Run tests with:
```bash
npm test -- constraint_merging
```

The test suite includes conceptual tests that verify the expected behavior logic. For full integration tests, see `tests/loccitane/orchestrator.test.ts` and `tests/loccitane/orchestrator.integration.test.ts`.

## Performance Impact

- **No performance degradation**: Intersection logic is efficient (Set operations)
- **Improved result quality**: More relevant products returned due to correct intersection logic
- **Better user experience**: Refinement queries now work correctly (e.g., "lavender ones instead")

## Future Considerations

1. **Per-constraint replace flags**: Currently, `replace: true` applies globally. Could enhance to support per-constraint-type replace flags if needed.

2. **Classification optimization**: For REFINE routes, could skip constraint extraction for types already in refinePatch (minimal performance gain, but adds complexity).

3. **Normalization improvements**: Could enhance normalization to handle more edge cases (synonyms, misspellings, etc.).

