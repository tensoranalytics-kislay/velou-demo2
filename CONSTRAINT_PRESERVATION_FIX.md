# Constraint Preservation Fix

## Issue

The enhanced query text was losing previously merged attributes in follow-up queries:

1. **Test 2 - Replace Operations:**
   - "mini instead" → "navy mini dresses" ✓ (has mini)
   - "size 6 instead" → "navy dresses size 6" ✗ (lost "mini" and "cotton")

2. **Test 6 - Complex Multi-Attribute:**
   - "dresses for wedding" → "dresses for wedding" ✓
   - "in light colours" → "dresses for wedding in light colours" ✓ (has wedding)
   - "floral ones" → "light coloured floral dresses" ✗ (lost "wedding")
   - "maxi length" → "light coloured maxi dresses" ✗ (lost "wedding", "floral")
   - "long sleeves" → "light coloured maxi dresses with long sleeves" ✓ (has maxi, long sleeves)
   - "v-neck" → "light coloured v-neck dresses" ✗ (lost "wedding", "floral", "maxi", "long sleeves")

## Root Cause

The constraint merger prompt was not explicit enough about preserving ALL previously merged attributes. The LLM was:
- Correctly merging constraints at the data level
- But losing attributes in the enhanced query text generation
- Not following a clear checklist to verify all attributes are preserved

## Fix Applied

Enhanced **Rule 11** in `CONSTRAINT_MERGER_PROMPT` with:

1. **Explicit Checklist** - Lists all constraint types that must be preserved:
   - Product type, colors, materials, patterns, styles, lengths, sleeveLengths, necklines, fits, rises, sizes, occasions, seasons, price, age groups, etc.

2. **Critical Examples** - Shows exactly what happens when attributes are lost:
   - ❌ WRONG: "navy dresses size 6" (lost "cotton" and "mini")
   - ✅ CORRECT: "navy cotton mini dresses size 6" (preserved all)

3. **Step-by-Step Process** - Clear instructions:
   1. Decompose PREVIOUS_QUERY into ALL components
   2. Extract new/modified constraints from CURRENT_MESSAGE
   3. Determine merge action for each constraint type
   4. For REPLACE: Replace ONLY the specific constraint, keep ALL others
   5. For MERGE: Add new constraint, keep ALL previous constraints
   6. Recompose enhancedQueryText including ALL preserved attributes
   7. Verify checklist before finalizing

4. **Verification Step** - Added Rule 12 that requires verification:
   - After generating enhancedQueryText, verify it includes ALL attributes from PREVIOUS_QUERY
   - If ANY attribute is missing (and wasn't explicitly replaced/removed/excluded), add it back

## Expected Behavior After Fix

**Test 2 - Replace Operations:**
- "navy cotton mini dresses" + "size 6 instead" → "navy cotton mini dresses size 6" ✅ (preserves "cotton" and "mini")

**Test 6 - Complex Multi-Attribute:**
- "light coloured floral maxi dresses with long sleeves for wedding" + "v-neck" → "light coloured floral maxi dresses with long sleeves v-neck for wedding" ✅ (preserves ALL previous attributes)

## Testing

Re-run the test script to verify the fix:
```bash
npx tsx test-constraint-merger-followups.ts
```

Expected improvements:
- All previously merged attributes preserved in enhanced query text
- No loss of context across multiple follow-ups
- Natural query text that includes all merged attributes
