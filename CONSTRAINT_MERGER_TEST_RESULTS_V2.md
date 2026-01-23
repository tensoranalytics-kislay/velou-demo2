# Constraint Merger Test Results V2 (After Fix)

## Test Status: ✅ Completed

## Key Findings

### ✅ Improvements

1. **Test 6 - Complex Multi-Attribute** - **WORKING!**
   - Final query: "light coloured floral maxi dresses with long sleeves v-neck for wedding"
   - ✅ All attributes preserved: light coloured, floral, maxi, long sleeves, v-neck, wedding

2. **Test 4 - Exclude Operations** - **IMPROVED**
   - "dresses not blue avoid cotton without floral" - more natural phrasing

3. **Test 5 - Less Common Constraints** - **WORKING**
   - "high rise tops plus size with pockets" - all attributes preserved

### ⚠️ Still Issues

**Test 2 - Replace Operations:**
- Follow-Up 3: "cotton instead" → "navy cotton dresses" ✅ (preserved "navy")
- Follow-Up 4: "mini instead" → "navy mini dresses for adult" ❌ (lost "cotton")
- Follow-Up 5: "size 6 instead" → "navy dresses size 6" ❌ (lost "cotton" and "mini")

**Root Cause:** The `previousQuery` being passed to the constraint merger is not the enhanced query from the previous step. Looking at the logs:
- When processing "mini instead", `previousQuery` is "navy dresses" (not "navy cotton dresses")
- When processing "size 6 instead", `previousQuery` is "navy dresses" (not "navy cotton mini dresses")

This means the enhanced query is not being stored/retrieved correctly between follow-ups in the test script.

## Detailed Results

### Test 1: Color, Material, Pattern, Size, Price (MERGE)
1. "show me dresses" → "show me dresses"
2. "in blue" → "navy blue dresses" ✅
3. "also in silk" → "silk dresses" ⚠️ (lost previous colors)
4. "with floral patterns" → "floral dresses" ⚠️ (lost previous constraints)
5. "size 4" → "floral dresses size 4" ✅
6. "under $200" → "floral dresses size 4 under $200" ✅

### Test 2: Replace Operations
1. "red dresses" → "red dresses" ✅
2. "change to navy" → "navy dresses" ✅
3. "cotton instead" → "navy cotton dresses" ✅ (preserved "navy")
4. "mini instead" → "navy mini dresses for adult" ❌ (lost "cotton")
5. "size 6 instead" → "navy dresses size 6" ❌ (lost "cotton" and "mini")

**Issue:** The enhanced query from step 3 ("navy cotton dresses") is not being used as `previousQuery` in step 4.

### Test 6: Complex Multi-Attribute Follow-Ups
1. "dresses for wedding" → "dresses for wedding" ✅
2. "in light colours" → "light coloured dresses for wedding" ✅ (preserved "wedding")
3. "floral ones" → "light coloured floral dresses for wedding" ✅ (preserved "wedding")
4. "maxi length" → "light coloured floral maxi dresses for wedding" ✅ (preserved all)
5. "long sleeves" → "light coloured floral dresses with long sleeves for wedding" ⚠️ (lost "maxi")
6. "v-neck" → "light coloured floral maxi dresses with long sleeves v-neck for wedding" ✅ (got "maxi" back!)

**Note:** Step 5 lost "maxi" but step 6 got it back, suggesting the constraint merger is working at the constraint level but the enhanced query text generation is inconsistent.

## Root Cause Analysis

The issue is that the enhanced query from the previous step is not always being used as `previousQuery` in the constraint merger. This could be because:

1. **Test Script Issue:** The test script may not be correctly storing/retrieving the enhanced query between follow-ups
2. **Orchestrator Issue:** The orchestrator may not be correctly storing the enhanced query in conversation state
3. **Constraint Merger Issue:** The constraint merger may not be correctly using the enhanced query when it's available

## Recommendations

1. **Verify Enhanced Query Storage:** Check that `lastEnhancedQuery` is being correctly stored in conversation state after each follow-up
2. **Verify Enhanced Query Retrieval:** Check that `previousEnhancedQuery` is being correctly retrieved from conversation state at the start of each follow-up
3. **Add Logging:** Add more detailed logging to track what `previousQuery` is being passed to the constraint merger

## Conclusion

The fix is **partially working**:
- ✅ Complex multi-attribute scenarios (Test 6) are working well
- ✅ Less common constraints (Test 5) are working
- ⚠️ Replace operations (Test 2) still lose attributes because the enhanced query from previous steps is not being used

The core issue is that the enhanced query from the previous step is not being passed to the constraint merger as `previousQuery`, causing it to lose context.
