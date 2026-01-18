# Comprehensive Pipeline Test Results

## Test Prompts Used

### Test 1: Direct Gender Specification
**Query**: "Show me jeans for women"
**Type**: Direct gender specification with product type
**Expected**: Female gender, women's jeans

### Test 2: Occasion-Based (Business)
**Query**: "I need a dress shirt for a business meeting"
**Type**: Occasion-based query (business meeting implies formal men's wear)
**Expected**: Male gender, dress shirts

### Test 3: Occasion-Based (Wedding)
**Query**: "What should I wear to a beach wedding?"
**Type**: Occasion-based query (beach wedding - typically dress, implies female)
**Expected**: Female gender, dresses

### Test 4: Indirect Gender via Style
**Query**: "I want high-rise skinny jeans in dark colors"
**Type**: Indirect gender via style indicators (high-rise skinny = female)
**Expected**: Female gender, women's jeans

### Test 5: Context-Based
**Query**: "Looking for comfortable loungewear for working from home"
**Type**: Context-based query (gender-neutral but should infer from context or default)
**Expected**: Gender may be inferred or default, loungewear products

## Results Summary

| Test | Query | Products | Wrong Gender | Status |
|------|-------|----------|--------------|--------|
| 1 | "Show me jeans for women" | 4 | 0* | ✅ PASS |
| 2 | "I need a dress shirt for a business meeting" | 0 | N/A | ⚠️ NO RESULTS |
| 3 | "What should I wear to a beach wedding?" | 4 | 0 | ✅ PASS |
| 4 | "I want high-rise skinny jeans in dark colors" | 4 | 3** | ❌ FAIL |
| 5 | "Looking for comfortable loungewear..." | 4 | 0 | ✅ PASS |

*Note: Test script incorrectly flagged "Women's" products as wrong gender - this is a bug in the detection logic
**Test 4 returned men's products when it should return women's (high-rise skinny jeans)

## Detailed Analysis Needed

Checking logs to verify:
1. Gender extraction is working
2. Category classification is working
3. Gender filter is being applied
4. Why Test 4 is returning wrong gender products
