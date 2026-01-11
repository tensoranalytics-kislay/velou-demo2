# Constraint Extraction Test Prompts

## Overview
These prompts are designed to test the enhanced constraint extraction pipeline after upgrading to GPT-4.1 and improving the classifier prompt. Each prompt tests multiple constraint types and should extract ALL explicitly mentioned constraints.

## Test Configuration
- **Model**: GPT-4.1 (primary model)
- **Max Tokens**: 2000
- **Expected Behavior**: All explicitly mentioned constraints (colors, lengths, sleeves, age groups) should be extracted

---

## Test Prompt 1: Comprehensive Multi-Constraint Query
**Query**: `"blue maxi dresses with long sleeves for kids"`

### Expected Constraint Extraction:
- ✅ **colors**: `["Blue"]` - "blue" is explicitly mentioned
- ✅ **lengths**: `["Maxi"]` - "maxi" is explicitly mentioned
- ✅ **sleeveLengths**: `["Long Sleeve"]` - "long sleeves" is explicitly mentioned
- ✅ **ageGroups**: `["Kids"]` - "kids" is explicitly mentioned
- ✅ **productTerms**: `"maxi dress"` or `"dress"` (constraints removed from product terms)

### Verification Steps:
1. Check logs for `classifyQuery: llm_raw_response` - verify LLM returned all 4 constraints
2. Check logs for `classifyQuery: constraint_extraction_results` - verify all constraints were extracted
3. Check logs for `classifier_constraints_extracted` - verify no missing constraints warning
4. Verify final constraints in `classifier_constraints_extracted` log include:
   - `colors: ["Blue"]`
   - `lengths: ["Maxi"]`
   - `sleeveLengths: ["Long Sleeve"]`
   - `ageGroups: ["Kids"]`
5. **Expected Result**: Should return ONLY blue, maxi-length, long-sleeved dresses for kids. NO pink, mini, or sleeveless dresses.

### Success Criteria:
- ✅ All 4 constraints extracted (colors, lengths, sleeveLengths, ageGroups)
- ✅ No missing constraints warning in logs
- ✅ Product recommendations match all constraints (blue, maxi, long sleeves, kids)
- ✅ Post-SQL filtering applied correctly (no pink/velvet rose colors, no mini lengths, no sleeveless products)

### Failure Indicators:
- ❌ Missing any of the 4 constraints in extraction logs
- ❌ Warning: `classifier_constraints_missing` appears in logs
- ❌ Products returned don't match one or more constraints (e.g., pink dresses, mini dresses, sleeveless)

---

## Test Prompt 2: Color and Length Only (No Sleeves Mentioned)
**Query**: `"red mini dresses for toddlers"`

### Expected Constraint Extraction:
- ✅ **colors**: `["Red"]` - "red" is explicitly mentioned
- ✅ **lengths**: `["Mini"]` - "mini" is explicitly mentioned
- ✅ **ageGroups**: `["Toddler"]` - "toddlers" is explicitly mentioned
- ✅ **sleeveLengths**: `null` or `undefined` - sleeves not mentioned (correct to omit)
- ✅ **productTerms**: `"mini dress"` or `"dress"`

### Verification Steps:
1. Check logs for `classifyQuery: llm_raw_response` - verify LLM returned colors, lengths, ageGroups (but NOT sleeveLengths)
2. Check logs for `classifyQuery: constraint_extraction_results` - verify colors, lengths, ageGroups extracted
3. Check logs for `classifier_constraints_extracted` - verify no false positives (no sleeveLengths extracted)
4. Verify final constraints include:
   - `colors: ["Red"]`
   - `lengths: ["Mini"]`
   - `ageGroups: ["Toddler"]`
   - `sleeveLengths: undefined` or `null` (should NOT be extracted)

### Success Criteria:
- ✅ Colors, lengths, and ageGroups extracted
- ✅ SleeveLengths NOT extracted (correct behavior - not mentioned)
- ✅ No missing constraints warning (colors, lengths, ageGroups all present)
- ✅ Product recommendations match all extracted constraints (red, mini, toddlers)
- ✅ Products can have any sleeve type (not filtered by sleeve since not mentioned)

### Failure Indicators:
- ❌ Missing colors, lengths, or ageGroups
- ❌ Incorrectly extracting sleeveLengths when not mentioned
- ❌ Warning: `classifier_constraints_missing` appears
- ❌ Products returned don't match extracted constraints (e.g., blue dresses, maxi dresses, kids instead of toddlers)

---

## Test Prompt 3: Complex Query with Multiple Colors and Sleeve Constraint
**Query**: `"white or ivory long sleeve tops for 12 year old girls"`

### Expected Constraint Extraction:
- ✅ **colors**: `["White", "Ivory"]` - "white" and "ivory" are explicitly mentioned
- ✅ **sleeveLengths**: `["Long Sleeve"]` - "long sleeve" is explicitly mentioned
- ✅ **ageGroups**: `["Tween"]` - "12 year old" maps to Tween (10-12 age range)
- ✅ **lengths**: `null` or `undefined` - length not mentioned for tops (correct to omit)
- ✅ **productTerms**: `"top"` or `"tops"`

### Verification Steps:
1. Check logs for `classifyQuery: llm_raw_response` - verify LLM returned multiple colors (White, Ivory), sleeveLengths, ageGroups
2. Check logs for `classifyQuery: constraint_extraction_results` - verify:
   - `colors: ["White", "Ivory"]` (array with 2 colors)
   - `sleeveLengths: ["Long Sleeve"]`
   - `ageGroups: ["Tween"]` (NOT "Kids" or "Teen" - must be Tween for 12 year old)
3. Check logs for `classifier_constraints_extracted` - verify all constraints present
4. Verify age group normalization - "12 year old" should map to "Tween" (not "Kids" or "Teen")
5. Verify final constraints include:
   - `colors: ["White", "Ivory"]` (both colors)
   - `sleeveLengths: ["Long Sleeve"]`
   - `ageGroups: ["Tween"]`
   - `lengths: undefined` or `null` (correct - tops don't have length attribute)

### Success Criteria:
- ✅ Multiple colors extracted (White AND Ivory)
- ✅ SleeveLengths extracted correctly
- ✅ Age group correctly mapped to "Tween" for 12 year old (NOT "Kids" or "Teen")
- ✅ Lengths NOT extracted (correct - tops don't have length)
- ✅ No missing constraints warning
- ✅ Product recommendations match all constraints (white/ivory, long sleeves, Tween age group)
- ✅ Post-SQL filtering allows both White and Ivory colors

### Failure Indicators:
- ❌ Only one color extracted (should be both White and Ivory)
- ❌ Age group incorrectly mapped (e.g., "Kids" or "Teen" instead of "Tween")
- ❌ Missing sleeveLengths constraint
- ❌ Incorrectly extracting lengths for tops
- ❌ Warning: `classifier_constraints_missing` appears
- ❌ Products returned don't match all constraints

---

## Logging Checklist

For each test prompt, verify these log entries exist and contain expected values:

### 1. Initial LLM Call Logs
```
classifyQuery: llm_raw_response
- parsedConstraints.colors: Should match expected colors
- parsedConstraints.lengths: Should match expected lengths
- parsedConstraints.sleeveLengths: Should match expected sleeves
- parsedConstraints.ageGroups: Should match expected age groups
```

### 2. Constraint Extraction Results
```
classifyQuery: constraint_extraction_results
- extractedColors: Should match expected colors array
- extractedLengths: Should match expected lengths array
- extractedSleeveLengths: Should match expected sleeves array
- extractedAgeGroups: Should match expected age groups array
```

### 3. Final Classification Results
```
classifier_constraints_extracted
- colors: Should match expected colors
- lengths: Should match expected lengths (or null if not mentioned)
- sleeveLengths: Should match expected sleeves (or null if not mentioned)
- ageGroups: Should match expected age groups
- missingConstraints: Should be undefined or empty array (no missing constraints)
```

### 4. Warning Logs (Should NOT appear if extraction is correct)
```
classifier_constraints_missing
- Should NOT appear if all explicit constraints were extracted
- If it appears, check missingConstraints array to see which constraints were missed
```

### 5. Post-SQL Filtering Logs (if ENABLE_POST_SQL_FILTERING=true)
```
applyPostSQLFilters: processing
- colors: Count of color filters applied
- lengths: Count of length filters applied
- sleeves: Count of sleeve filters applied
- Should match extracted constraints from classification

applyPostSQLFilters: completed
- originalCount: Number of products before post-filtering
- filteredCount: Number of products after post-filtering
- reductionPercentage: Percentage of products filtered out
```

---

## Expected Database Query Patterns

After constraint extraction, verify the search pipeline uses these constraints:

### Test Prompt 1: "blue maxi dresses with long sleeves for kids"
- SQL filter: `category = 'Girls Dresses'` AND `ageGroup LIKE '%Kids%'` AND `color LIKE '%Blue%'` AND `length = 'Maxi'`
- Post-SQL filter: `sleeve = 'Long'` (applied via category-specific dictionary)

### Test Prompt 2: "red mini dresses for toddlers"
- SQL filter: `category = 'Girls Dresses'` AND `ageGroup LIKE '%Toddler%'` AND `color LIKE '%Red%'` AND `length = 'Mini'`
- Post-SQL filter: None (sleeves not mentioned)

### Test Prompt 3: "white or ivory long sleeve tops for 12 year old girls"
- SQL filter: `category = 'Girls Tops'` AND `ageGroup LIKE '%Tween%'` AND (`color LIKE '%White%'` OR `color LIKE '%Ivory%'`)
- Post-SQL filter: `sleeve = 'Long'` (applied via category-specific dictionary)

---

## Quick Test Commands

After starting the app, test each prompt:

```bash
# Test Prompt 1
curl -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"message": "blue maxi dresses with long sleeves for kids", "sessionId": "test-1"}'

# Test Prompt 2
curl -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"message": "red mini dresses for toddlers", "sessionId": "test-2"}'

# Test Prompt 3
curl -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"message": "white or ivory long sleeve tops for 12 year old girls", "sessionId": "test-3"}'
```

Or test via the UI at `http://localhost:3000` and check the terminal logs.

---

## Success Metrics

### Overall Success Criteria:
1. ✅ **100% constraint extraction accuracy** - All explicitly mentioned constraints extracted
2. ✅ **0% false positive rate** - No constraints extracted when not mentioned
3. ✅ **100% constraint validation** - All extracted constraints pass dictionary validation
4. ✅ **0 missing constraints warnings** - No `classifier_constraints_missing` warnings in logs
5. ✅ **Correct product filtering** - Products returned match all extracted constraints

### Performance Targets:
- Constraint extraction: < 2 seconds (GPT-4.1 latency)
- Overall query response: < 4 seconds end-to-end
- Post-SQL filtering: < 500ms

---

## Troubleshooting Guide

### If constraints are missing:
1. Check `classifyQuery: llm_raw_response` - Did LLM return the constraint?
2. Check `classifyQuery: constraint_extraction_results` - Was it extracted correctly?
3. Check `classifier_constraints_missing` - Which constraints are missing?
4. Verify prompt includes explicit examples of the missing constraint type
5. Check if constraint word matches expected format (e.g., "blue" not "bluish")

### If constraints are incorrectly extracted:
1. Check dictionary validation logs - Was constraint validated against ontology?
2. Check age group normalization - Was age correctly mapped to dictionary value?
3. Check color validation - Was color normalized to ontology term?
4. Verify schema allows the constraint type (colors, lengths, sleeves, ageGroups)

### If products don't match constraints:
1. Check post-SQL filtering logs - Are filters being applied?
2. Check SQL query logs - Are constraints included in SQL WHERE clause?
3. Check product attributes in database - Do products actually have matching attributes?
4. Verify `ENABLE_POST_SQL_FILTERING=true` is set in .env

---

## Notes

- These prompts test the **constraint extraction** phase, not the full product search pipeline
- Success is measured by **accurate constraint extraction**, not necessarily by finding products
- If no products match all constraints, that's OK - the important thing is constraints were extracted correctly
- Check logs first, then product results, to verify extraction accuracy


## Overview
These prompts are designed to test the enhanced constraint extraction pipeline after upgrading to GPT-4.1 and improving the classifier prompt. Each prompt tests multiple constraint types and should extract ALL explicitly mentioned constraints.

## Test Configuration
- **Model**: GPT-4.1 (primary model)
- **Max Tokens**: 2000
- **Expected Behavior**: All explicitly mentioned constraints (colors, lengths, sleeves, age groups) should be extracted

---

## Test Prompt 1: Comprehensive Multi-Constraint Query
**Query**: `"blue maxi dresses with long sleeves for kids"`

### Expected Constraint Extraction:
- ✅ **colors**: `["Blue"]` - "blue" is explicitly mentioned
- ✅ **lengths**: `["Maxi"]` - "maxi" is explicitly mentioned
- ✅ **sleeveLengths**: `["Long Sleeve"]` - "long sleeves" is explicitly mentioned
- ✅ **ageGroups**: `["Kids"]` - "kids" is explicitly mentioned
- ✅ **productTerms**: `"maxi dress"` or `"dress"` (constraints removed from product terms)

### Verification Steps:
1. Check logs for `classifyQuery: llm_raw_response` - verify LLM returned all 4 constraints
2. Check logs for `classifyQuery: constraint_extraction_results` - verify all constraints were extracted
3. Check logs for `classifier_constraints_extracted` - verify no missing constraints warning
4. Verify final constraints in `classifier_constraints_extracted` log include:
   - `colors: ["Blue"]`
   - `lengths: ["Maxi"]`
   - `sleeveLengths: ["Long Sleeve"]`
   - `ageGroups: ["Kids"]`
5. **Expected Result**: Should return ONLY blue, maxi-length, long-sleeved dresses for kids. NO pink, mini, or sleeveless dresses.

### Success Criteria:
- ✅ All 4 constraints extracted (colors, lengths, sleeveLengths, ageGroups)
- ✅ No missing constraints warning in logs
- ✅ Product recommendations match all constraints (blue, maxi, long sleeves, kids)
- ✅ Post-SQL filtering applied correctly (no pink/velvet rose colors, no mini lengths, no sleeveless products)

### Failure Indicators:
- ❌ Missing any of the 4 constraints in extraction logs
- ❌ Warning: `classifier_constraints_missing` appears in logs
- ❌ Products returned don't match one or more constraints (e.g., pink dresses, mini dresses, sleeveless)

---

## Test Prompt 2: Color and Length Only (No Sleeves Mentioned)
**Query**: `"red mini dresses for toddlers"`

### Expected Constraint Extraction:
- ✅ **colors**: `["Red"]` - "red" is explicitly mentioned
- ✅ **lengths**: `["Mini"]` - "mini" is explicitly mentioned
- ✅ **ageGroups**: `["Toddler"]` - "toddlers" is explicitly mentioned
- ✅ **sleeveLengths**: `null` or `undefined` - sleeves not mentioned (correct to omit)
- ✅ **productTerms**: `"mini dress"` or `"dress"`

### Verification Steps:
1. Check logs for `classifyQuery: llm_raw_response` - verify LLM returned colors, lengths, ageGroups (but NOT sleeveLengths)
2. Check logs for `classifyQuery: constraint_extraction_results` - verify colors, lengths, ageGroups extracted
3. Check logs for `classifier_constraints_extracted` - verify no false positives (no sleeveLengths extracted)
4. Verify final constraints include:
   - `colors: ["Red"]`
   - `lengths: ["Mini"]`
   - `ageGroups: ["Toddler"]`
   - `sleeveLengths: undefined` or `null` (should NOT be extracted)

### Success Criteria:
- ✅ Colors, lengths, and ageGroups extracted
- ✅ SleeveLengths NOT extracted (correct behavior - not mentioned)
- ✅ No missing constraints warning (colors, lengths, ageGroups all present)
- ✅ Product recommendations match all extracted constraints (red, mini, toddlers)
- ✅ Products can have any sleeve type (not filtered by sleeve since not mentioned)

### Failure Indicators:
- ❌ Missing colors, lengths, or ageGroups
- ❌ Incorrectly extracting sleeveLengths when not mentioned
- ❌ Warning: `classifier_constraints_missing` appears
- ❌ Products returned don't match extracted constraints (e.g., blue dresses, maxi dresses, kids instead of toddlers)

---

## Test Prompt 3: Complex Query with Multiple Colors and Sleeve Constraint
**Query**: `"white or ivory long sleeve tops for 12 year old girls"`

### Expected Constraint Extraction:
- ✅ **colors**: `["White", "Ivory"]` - "white" and "ivory" are explicitly mentioned
- ✅ **sleeveLengths**: `["Long Sleeve"]` - "long sleeve" is explicitly mentioned
- ✅ **ageGroups**: `["Tween"]` - "12 year old" maps to Tween (10-12 age range)
- ✅ **lengths**: `null` or `undefined` - length not mentioned for tops (correct to omit)
- ✅ **productTerms**: `"top"` or `"tops"`

### Verification Steps:
1. Check logs for `classifyQuery: llm_raw_response` - verify LLM returned multiple colors (White, Ivory), sleeveLengths, ageGroups
2. Check logs for `classifyQuery: constraint_extraction_results` - verify:
   - `colors: ["White", "Ivory"]` (array with 2 colors)
   - `sleeveLengths: ["Long Sleeve"]`
   - `ageGroups: ["Tween"]` (NOT "Kids" or "Teen" - must be Tween for 12 year old)
3. Check logs for `classifier_constraints_extracted` - verify all constraints present
4. Verify age group normalization - "12 year old" should map to "Tween" (not "Kids" or "Teen")
5. Verify final constraints include:
   - `colors: ["White", "Ivory"]` (both colors)
   - `sleeveLengths: ["Long Sleeve"]`
   - `ageGroups: ["Tween"]`
   - `lengths: undefined` or `null` (correct - tops don't have length attribute)

### Success Criteria:
- ✅ Multiple colors extracted (White AND Ivory)
- ✅ SleeveLengths extracted correctly
- ✅ Age group correctly mapped to "Tween" for 12 year old (NOT "Kids" or "Teen")
- ✅ Lengths NOT extracted (correct - tops don't have length)
- ✅ No missing constraints warning
- ✅ Product recommendations match all constraints (white/ivory, long sleeves, Tween age group)
- ✅ Post-SQL filtering allows both White and Ivory colors

### Failure Indicators:
- ❌ Only one color extracted (should be both White and Ivory)
- ❌ Age group incorrectly mapped (e.g., "Kids" or "Teen" instead of "Tween")
- ❌ Missing sleeveLengths constraint
- ❌ Incorrectly extracting lengths for tops
- ❌ Warning: `classifier_constraints_missing` appears
- ❌ Products returned don't match all constraints

---

## Logging Checklist

For each test prompt, verify these log entries exist and contain expected values:

### 1. Initial LLM Call Logs
```
classifyQuery: llm_raw_response
- parsedConstraints.colors: Should match expected colors
- parsedConstraints.lengths: Should match expected lengths
- parsedConstraints.sleeveLengths: Should match expected sleeves
- parsedConstraints.ageGroups: Should match expected age groups
```

### 2. Constraint Extraction Results
```
classifyQuery: constraint_extraction_results
- extractedColors: Should match expected colors array
- extractedLengths: Should match expected lengths array
- extractedSleeveLengths: Should match expected sleeves array
- extractedAgeGroups: Should match expected age groups array
```

### 3. Final Classification Results
```
classifier_constraints_extracted
- colors: Should match expected colors
- lengths: Should match expected lengths (or null if not mentioned)
- sleeveLengths: Should match expected sleeves (or null if not mentioned)
- ageGroups: Should match expected age groups
- missingConstraints: Should be undefined or empty array (no missing constraints)
```

### 4. Warning Logs (Should NOT appear if extraction is correct)
```
classifier_constraints_missing
- Should NOT appear if all explicit constraints were extracted
- If it appears, check missingConstraints array to see which constraints were missed
```

### 5. Post-SQL Filtering Logs (if ENABLE_POST_SQL_FILTERING=true)
```
applyPostSQLFilters: processing
- colors: Count of color filters applied
- lengths: Count of length filters applied
- sleeves: Count of sleeve filters applied
- Should match extracted constraints from classification

applyPostSQLFilters: completed
- originalCount: Number of products before post-filtering
- filteredCount: Number of products after post-filtering
- reductionPercentage: Percentage of products filtered out
```

---

## Expected Database Query Patterns

After constraint extraction, verify the search pipeline uses these constraints:

### Test Prompt 1: "blue maxi dresses with long sleeves for kids"
- SQL filter: `category = 'Girls Dresses'` AND `ageGroup LIKE '%Kids%'` AND `color LIKE '%Blue%'` AND `length = 'Maxi'`
- Post-SQL filter: `sleeve = 'Long'` (applied via category-specific dictionary)

### Test Prompt 2: "red mini dresses for toddlers"
- SQL filter: `category = 'Girls Dresses'` AND `ageGroup LIKE '%Toddler%'` AND `color LIKE '%Red%'` AND `length = 'Mini'`
- Post-SQL filter: None (sleeves not mentioned)

### Test Prompt 3: "white or ivory long sleeve tops for 12 year old girls"
- SQL filter: `category = 'Girls Tops'` AND `ageGroup LIKE '%Tween%'` AND (`color LIKE '%White%'` OR `color LIKE '%Ivory%'`)
- Post-SQL filter: `sleeve = 'Long'` (applied via category-specific dictionary)

---

## Quick Test Commands

After starting the app, test each prompt:

```bash
# Test Prompt 1
curl -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"message": "blue maxi dresses with long sleeves for kids", "sessionId": "test-1"}'

# Test Prompt 2
curl -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"message": "red mini dresses for toddlers", "sessionId": "test-2"}'

# Test Prompt 3
curl -X POST http://localhost:3000/api/assistant \
  -H "Content-Type: application/json" \
  -d '{"message": "white or ivory long sleeve tops for 12 year old girls", "sessionId": "test-3"}'
```

Or test via the UI at `http://localhost:3000` and check the terminal logs.

---

## Success Metrics

### Overall Success Criteria:
1. ✅ **100% constraint extraction accuracy** - All explicitly mentioned constraints extracted
2. ✅ **0% false positive rate** - No constraints extracted when not mentioned
3. ✅ **100% constraint validation** - All extracted constraints pass dictionary validation
4. ✅ **0 missing constraints warnings** - No `classifier_constraints_missing` warnings in logs
5. ✅ **Correct product filtering** - Products returned match all extracted constraints

### Performance Targets:
- Constraint extraction: < 2 seconds (GPT-4.1 latency)
- Overall query response: < 4 seconds end-to-end
- Post-SQL filtering: < 500ms

---

## Troubleshooting Guide

### If constraints are missing:
1. Check `classifyQuery: llm_raw_response` - Did LLM return the constraint?
2. Check `classifyQuery: constraint_extraction_results` - Was it extracted correctly?
3. Check `classifier_constraints_missing` - Which constraints are missing?
4. Verify prompt includes explicit examples of the missing constraint type
5. Check if constraint word matches expected format (e.g., "blue" not "bluish")

### If constraints are incorrectly extracted:
1. Check dictionary validation logs - Was constraint validated against ontology?
2. Check age group normalization - Was age correctly mapped to dictionary value?
3. Check color validation - Was color normalized to ontology term?
4. Verify schema allows the constraint type (colors, lengths, sleeves, ageGroups)

### If products don't match constraints:
1. Check post-SQL filtering logs - Are filters being applied?
2. Check SQL query logs - Are constraints included in SQL WHERE clause?
3. Check product attributes in database - Do products actually have matching attributes?
4. Verify `ENABLE_POST_SQL_FILTERING=true` is set in .env

---

## Notes

- These prompts test the **constraint extraction** phase, not the full product search pipeline
- Success is measured by **accurate constraint extraction**, not necessarily by finding products
- If no products match all constraints, that's OK - the important thing is constraints were extracted correctly
- Check logs first, then product results, to verify extraction accuracy

