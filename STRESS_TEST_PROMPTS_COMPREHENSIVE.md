# Comprehensive Stress Test Prompts
## Testing All Product Categories and Customer Journey Types

This document contains 5 comprehensive prompt sets designed to stress test:
- **All product categories** (Dresses, Tops, Bottoms, Swimwear, Accessories, Home & Living, Personal Care)
- **All customer journey types** (Discovery, Refinement, Follow-up, Comparison, Problem-solving)
- **All constraint types** (Colors, Lengths, Sleeves, Age Groups, Occasions, Materials, etc.)
- **Edge cases** (Vague queries, Complex constraints, Multi-constraint filtering)

---

## Prompt Set 1: Discovery Journey - Multi-Category Exploration
**Customer Journey**: New customer exploring different product categories with varying specificity levels

### Test Prompts:

1. **Very Vague Discovery Query**
   - Query: `"show me something pretty for my daughter"`
   - **Expected Behavior**: Should extract age group (kids/children), explore multiple categories, return diverse product types
   - **Verify**: Age group extracted, category classifier explores options, diverse results

2. **Category-Specific Discovery**
   - Query: `"I'm looking for a dress"`
   - **Expected Behavior**: Should classify as "direct_product_search", extract category "Dresses", show variety
   - **Verify**: Category classified correctly, no false constraints extracted

3. **Color-Focused Discovery**
   - Query: `"anything in pink"`
   - **Expected Behavior**: Should extract colors: ["Pink"], search across all categories
   - **Verify**: Colors extracted correctly, products from multiple categories returned

4. **Occasion-Based Discovery**
   - Query: `"I need something for a beach wedding"`
   - **Expected Behavior**: Should extract occasions: ["Wedding", "Beach"], infer colors/materials/lengths
   - **Verify**: Occasion extracted, context-aware color/material inference works

5. **Multi-Constraint Discovery**
   - Query: `"blue maxi dress with long sleeves for kids"`
   - **Expected Behavior**: All 4 constraints extracted (colors, lengths, sleeveLengths, ageGroups)
   - **Verify**: All constraints extracted and applied correctly (already tested, should work)

6. **Material-Focused Discovery**
   - Query: `"cotton dresses"`
   - **Expected Behavior**: Should extract materials: ["Cotton"], category: "Dresses"
   - **Verify**: Material extracted, filtered correctly

7. **Seasonal Discovery**
   - Query: `"summer outfits for 8 year old"`
   - **Expected Behavior**: Should extract seasons: ["Summer"], ageGroups: ["Kids"], infer categories
   - **Verify**: Season + age group extracted, appropriate products returned

---

## Prompt Set 2: Refinement Journey - Progressive Filtering
**Customer Journey**: Customer starts broad, then progressively narrows down preferences

### Test Prompts (Use as a conversation flow):

1. **Initial Broad Query**
   - Query: `"show me dresses"`
   - **Expected Constraints**: category: "Dresses"
   - **Verify**: Returns variety of dresses

2. **Color Refinement**
   - Query: `"make it blue"`
   - **Last Constraints**: { category: "Dresses" }
   - **Expected Behavior**: Should merge - keep category, add colors: ["Blue"]
   - **Verify**: Category preserved, colors added, blue dresses only

3. **Length Refinement**
   - Query: `"and make it maxi"`
   - **Last Constraints**: { category: "Dresses", colors: ["Blue"] }
   - **Expected Behavior**: Should merge - keep category and colors, add lengths: ["Maxi"]
   - **Verify**: All previous constraints preserved, lengths added

4. **Age Group Refinement**
   - Query: `"for my 10 year old"`
   - **Last Constraints**: { category: "Dresses", colors: ["Blue"], lengths: ["Maxi"] }
   - **Expected Behavior**: Should merge - keep all, add ageGroups: ["Tween"]
   - **Verify**: All constraints preserved, age group correctly mapped (10 → Tween)

5. **Sleeve Refinement**
   - Query: `"with long sleeves please"`
   - **Last Constraints**: { category: "Dresses", colors: ["Blue"], lengths: ["Maxi"], ageGroups: ["Tween"] }
   - **Expected Behavior**: Should merge - keep all, add sleeveLengths: ["Long Sleeve"]
   - **Verify**: All previous constraints preserved, sleeves added

6. **Material Refinement**
   - Query: `"preferably cotton"`
   - **Last Constraints**: All previous constraints
   - **Expected Behavior**: Should merge - keep all, add materials: ["Cotton"] with intent "preferred"
   - **Verify**: All constraints preserved, material added with correct intent level

7. **Price Refinement**
   - Query: `"under $200"`
   - **Last Constraints**: All previous constraints
   - **Expected Behavior**: Should merge - keep all, add priceMaxCents: 20000
   - **Verify**: All constraints preserved, price filter added

8. **Reset/New Search Signal**
   - Query: `"actually, show me tops instead"`
   - **Last Constraints**: All previous constraints
   - **Expected Behavior**: Should reset/override - new category "Tops", drop conflicting constraints (lengths)
   - **Verify**: Category changed, conflicting constraints removed, new search started

---

## Prompt Set 3: Problem-Solving Journey - Specific Needs
**Customer Journey**: Customer has a specific problem or need to solve

### Test Prompts:

1. **Modesty Requirement**
   - Query: `"I need a modest dress with long sleeves for my muslim daughter"`
   - **Expected Behavior**: 
     - Should extract: category: "Dresses", sleeveLengths: ["Long Sleeve"], ageGroups: ["Kids"] or appropriate age
     - Should infer: lengths: ["Maxi", "Midi"] (avoid Mini), necklines: ["High Neck", "Round Neck"]
     - Should infer: modestyCues: ["Modest", "Coverage"]
   - **Verify**: Explicit constraints extracted, modesty-aware inference works, appropriate products

2. **Weather-Based Need**
   - Query: `"something warm for winter in Utah"`
   - **Expected Behavior**:
     - Should extract: seasons: ["Winter"], temperatureIntent: "Cool Weather"
     - Should infer: materials: ["Wool", "Cashmere", "Fleece"], colors: earth tones
     - Should infer: categories: ["Sweaters", "Bottoms", "Cold Weather Essentials"]
   - **Verify**: Weather context extracted, appropriate materials/colors inferred

3. **Body Type Consideration**
   - Query: `"plus size dresses that are flattering"`
   - **Expected Behavior**:
     - Should extract: category: "Dresses", fits: ["Relaxed", "A-Line", "Wrap"]
     - Should infer: styles: ["A-Line", "Wrap", "Fit and Flare"]
   - **Verify**: Body type consideration inferred, appropriate fits/styles recommended

4. **Gift Shopping**
   - Query: `"what would be a good gift for a 15 year old girl under $150"`
   - **Expected Behavior**:
     - Should extract: ageGroups: ["Teen"], priceMaxCents: 15000, useCases: ["Gift"]
     - Should explore: multiple categories (dresses, accessories, tops)
   - **Verify**: Gift context extracted, age-appropriate products across categories

5. **Travel Preparation**
   - Query: `"packable lightweight dresses for vacation"`
   - **Expected Behavior**:
     - Should extract: category: "Dresses", travelFeatures: ["Packable", "Lightweight"]
     - Should infer: materials: ["Linen", "Cotton"], useCases: ["Travel"]
   - **Verify**: Travel features extracted, appropriate materials inferred

6. **Formality Requirement**
   - Query: `"formal dress for a black tie event"`
   - **Expected Behavior**:
     - Should extract: occasions: ["Formal", "Evening"], formalityLevel: ["Formal"]
     - Should infer: colors: ["Black", "Navy", "Burgundy"], lengths: ["Maxi", "Midi"]
   - **Verify**: Formality extracted, appropriate styling inferred

7. **Cultural/Religious Event**
   - Query: `"traditional dress for an indian wedding"`
   - **Expected Behavior**:
     - Should extract: occasions: ["Wedding"], useCases: ["Wedding"]
     - Should infer: colors: ["Red", "Gold", "Maroon"], embellishments: ["Embroidered", "Sequined"]
   - **Verify**: Cultural context recognized, appropriate colors/embellishments inferred

---

## Prompt Set 4: Category Coverage - All Product Types
**Customer Journey**: Testing constraint extraction and filtering across ALL product categories

### Test Prompts:

1. **Girls Dresses** ✅ (Already tested)
   - Query: `"blue maxi dresses with long sleeves for kids"`
   - **Verify**: All constraints extracted, filtered correctly

2. **Girls Tops**
   - Query: `"white round neck tops with short sleeves for 7 year old"`
   - **Expected**: colors: ["White"], necklines: ["Round Neck"], sleeveLengths: ["Short Sleeve"], ageGroups: ["Kids"]
   - **Verify**: All constraints extracted, no length constraint (tops don't have length)

3. **Girls Bottoms**
   - Query: `"pink shorts for toddlers"`
   - **Expected**: category: "Girls Bottoms" or "Bottoms", colors: ["Pink"], ageGroups: ["Toddler"]
   - **Verify**: Category classified, age group correctly mapped (toddler)

4. **Girls Swimwear**
   - Query: `"one-piece swimsuits in blue for 5 year old"`
   - **Expected**: category: "Girls Swimwear" or "Swimsuits", colors: ["Blue"], ageGroups: ["Kids"]
   - **Verify**: Swimwear category classified, product type (one-piece) recognized

5. **Women's Dresses**
   - Query: `"red mini dress with v-neck for evening"`
   - **Expected**: category: "Women's Dresses", colors: ["Red"], lengths: ["Mini"], necklines: ["V-Neck"], occasions: ["Evening"]
   - **Verify**: Adult category, all constraints extracted

6. **Women's Tops**
   - Query: `"silk blouses in black for office"`
   - **Expected**: category: "Tops", materials: ["Silk"], colors: ["Black"], occasions: ["Office"]
   - **Verify**: Material + occasion extracted

7. **Women's Bottoms**
   - Query: `"white linen pants for summer"`
   - **Expected**: category: "Bottoms", colors: ["White"], materials: ["Linen"], seasons: ["Summer"]
   - **Verify**: Material + season extracted

8. **Accessories - Jewelry**
   - Query: `"gold jewelry for formal event"`
   - **Expected**: category: "Jewelry", colors: ["Gold"], occasions: ["Formal"]
   - **Verify**: Accessories category classified, constraints extracted

9. **Accessories - Bags**
   - Query: `"tote bags for travel"`
   - **Expected**: category: "Tote Bags" or "Accessories", useCases: ["Travel"]
   - **Verify**: Category classified, use case extracted

10. **Home & Living - Bedding**
    - Query: `"bedding sets in blush pink"`
    - **Expected**: category: "Bedding", colors: ["Blush", "Pink"], rooms: ["Bedroom"]
    - **Verify**: Home category classified, room inferred

11. **Home & Living - Candles**
    - Query: `"lavender scented candles"`
    - **Expected**: category: "Candles" or "Home & Living", scents: ["Lavender"]
    - **Verify**: Scents extracted (not colors), category classified

12. **Personal Care - Perfumes**
    - Query: `"vanilla perfume"`
    - **Expected**: category: "Perfumes", scents: ["Vanilla"]
    - **Verify**: Scents extracted (not colors), perfume category classified

---

## Prompt Set 5: Edge Cases & Complex Scenarios
**Customer Journey**: Testing edge cases, ambiguous queries, and complex constraint combinations

### Test Prompts:

1. **Ambiguous Color/Pattern**
   - Query: `"cherry dress"`
   - **Expected**: colors: ["Cherry"] (NOT patterns), category: "Dresses"
   - **Verify**: "Cherry" extracted as color, not pattern (per prompt rules)

2. **Multiple Age Groups**
   - Query: `"clothes for my 6 year old and 12 year old"`
   - **Expected**: ageGroups: ["Kids", "Tween"] (or ["Kids, Tween"] if combination exists)
   - **Verify**: Multiple age groups extracted correctly

3. **Negative Constraint**
   - Query: `"dresses not in black"`
   - **Expected**: colors: { values: ["Black"], intent: "excluded" } OR excludedColors: ["Black"]
   - **Verify**: Negative constraint extracted with correct intent

4. **Price Range**
   - Query: `"dresses between $100 and $300"`
   - **Expected**: priceMinCents: 10000, priceMaxCents: 30000
   - **Verify**: Price range extracted correctly (both min and max)

5. **"Any" Constraint**
   - Query: `"maxi dress in any color"`
   - **Expected**: lengths: ["Maxi"], colors: null or undefined (user explicitly said "any")
   - **Verify**: "Any" handled correctly, no color filter applied

6. **Comparative Query**
   - Query: `"something more casual"`
   - **Last Constraints**: { category: "Dresses", formalityLevel: ["Formal"] }
   - **Expected**: Should update formalityLevel to ["Casual"], preserve category
   - **Verify**: Comparative refinement works, correct constraints replaced

7. **Or/Alternative Query**
   - Query: `"red or pink dress"`
   - **Expected**: colors: ["Red", "Pink"], category: "Dresses"
   - **Verify**: Multiple colors extracted from "or" statement

8. **Complex Multi-Constraint**
   - Query: `"navy blue maxi dress with v-neck and long sleeves, in silk or chiffon, for formal evening event, under $400"`
   - **Expected**: 
     - colors: ["Navy", "Blue"]
     - lengths: ["Maxi"]
     - necklines: ["V-Neck"]
     - sleeveLengths: ["Long Sleeve"]
     - materials: ["Silk", "Chiffon"]
     - occasions: ["Formal", "Evening"]
     - priceMaxCents: 40000
   - **Verify**: All 7 constraint types extracted correctly

9. **Follow-up with "Instead"**
   - Query: `"instead, show me tops"`
   - **Last Constraints**: { category: "Dresses", colors: ["Blue"] }
   - **Expected**: Should reset category to "Tops", keep colors: ["Blue"], remove lengths (tops don't have length)
   - **Verify**: "Instead" triggers override, non-conflicting constraints preserved

10. **Unrelated Query**
    - Query: `"what's the weather today?"`
    - **Expected**: type: "unrelated", no constraints extracted
    - **Verify**: Unrelated queries handled gracefully, no product search attempted

11. **Extremely Vague Query**
    - Query: `"something nice"`
    - **Expected**: type: "gift_or_vague", minimal constraints, explore multiple categories
    - **Verify**: Vague queries don't break the system, appropriate fallback behavior

12. **Size + Age Confusion**
    - Query: `"size 6 dresses for 6 year old"`
    - **Expected**: sizes: ["6"], ageGroups: ["Kids"], category: "Dresses"
    - **Verify**: Size vs age correctly distinguished

13. **Material vs Category Confusion**
    - Query: `"linen"`
    - **Expected**: materials: ["Linen"], explore categories where linen products exist
    - **Verify**: Material-only queries handled, appropriate categories explored

14. **Follow-up Refinement Chain**
   - Sequence:
     1. `"show me dresses"`
     2. `"in blue"`
     3. `"make it maxi"`
     4. `"with long sleeves"`
     5. `"actually, make it sleeveless instead"`
   - **Expected**: Each step should correctly merge/update constraints, step 5 should replace sleeves
   - **Verify**: Complex refinement chain works, "instead" triggers replacement

---

## Verification Checklist for Each Prompt

For each prompt in all 5 sets, verify:

### Constraint Extraction ✅
- [ ] All explicitly mentioned constraints extracted
- [ ] No false positive constraints (constraints not mentioned)
- [ ] Intent levels correct (required/strong/preferred/excluded)
- [ ] Constraints correctly normalized to ontology values

### Context Awareness ✅
- [ ] Cultural/religious context recognized (if applicable)
- [ ] Occasion-appropriate inference (if applicable)
- [ ] Weather/season inference (if applicable)
- [ ] Age-appropriate styling inferred (if applicable)

### Category Classification ✅
- [ ] Correct category(ies) classified
- [ ] Category expansion works (if applicable)
- [ ] Subcategory filtering works (if applicable)

### Follow-up Handling ✅
- [ ] Previous constraints preserved (if refinement)
- [ ] New constraints added (if refinement)
- [ ] Constraints replaced (if override signal)
- [ ] Constraints reset (if new search signal)

### Product Filtering ✅
- [ ] Post-SQL filtering applied correctly
- [ ] Products match all extracted constraints
- [ ] No products that violate constraints
- [ ] Appropriate "no results" message if no matches

### Logging ✅
- [ ] `classifyQuery: llm_raw_response` logged (shows LLM output)
- [ ] `classifyQuery: constraint_extraction_results` logged (shows extracted constraints)
- [ ] `classifier_constraints_extracted` logged (shows final constraints)
- [ ] `classifier_constraints_missing` warning (if constraints missing - should be none for explicit mentions)
- [ ] Post-SQL filtering logs show correct filter application

---

## Success Metrics

### Overall Success Criteria:
1. ✅ **100% constraint extraction accuracy** - All explicitly mentioned constraints extracted
2. ✅ **<5% false positive rate** - Minimal false constraint extraction
3. ✅ **100% constraint validation** - All extracted constraints pass dictionary validation
4. ✅ **95% category classification accuracy** - Correct categories identified
5. ✅ **100% follow-up handling** - Refinement queries correctly merge/update constraints
6. ✅ **100% constraint filtering** - Products match all extracted constraints

### Performance Targets:
- Constraint extraction: < 3 seconds (GPT-4.1 latency)
- Overall query response: < 5 seconds end-to-end
- Post-SQL filtering: < 1 second

---

## Test Execution Order

1. **Start with Prompt Set 1** (Discovery) - Test basic functionality
2. **Then Prompt Set 2** (Refinement) - Test follow-up handling
3. **Then Prompt Set 4** (Category Coverage) - Test all product types
4. **Then Prompt Set 3** (Problem-Solving) - Test context-aware inference
5. **Finally Prompt Set 5** (Edge Cases) - Test robustness

---

## Notes

- **Test in sequence** for Prompt Set 2 (Refinement Journey) - use as a conversation flow
- **Test individually** for other sets - each prompt is independent
- **Check logs first**, then product results, to verify extraction accuracy
- **It's OK if no products match** - focus on constraint extraction accuracy, not product availability
- **Document any failures** - note which constraints were missed, which were incorrectly extracted

