# Stress Test Prompts for Age Groups & Pipeline

## Test Set 1: Age Group Hard Filtering
**Purpose**: Test age group extraction, normalization, and hard filtering across different age ranges

### Initial Queries
1. "dresses for kids"
2. "baby clothes"
3. "toddler outfits"
4. "teenage dresses"
5. "clothes for a 5-year-old"
6. "dresses for my 2-year-old daughter"
7. "outfits for teenagers"
8. "baby girl clothes"
9. "tween dresses"
10. "adult dresses"

### Follow-up Refinements
11. "make them pink" (after "dresses for kids")
12. "under $100" (after "baby clothes")
13. "not red" (after "toddler outfits")
14. "more casual" (after "teenage dresses")
15. "floral patterns" (after "clothes for a 5-year-old")

### Edge Cases
16. "dresses for kids, not red"
17. "baby clothes in any color except pink"
18. "toddler outfits under $50, not cotton"
19. "teenage dresses for prom, not black"
20. "clothes for a 5-year-old, size 4, not floral"

---

## Test Set 2: Color Hard Filtering & Exclusions
**Purpose**: Test color extraction, hard filtering, excluded colors, and multi-color queries

### Initial Queries
1. "red dresses"
2. "blue dresses for kids"
3. "cherry red dresses"
4. "dresses in light colors"
5. "pink dresses for baby"
6. "navy blue dresses"
7. "white dresses for wedding"
8. "black dresses, not formal"
9. "green dresses"
10. "yellow dresses for kids"

### Follow-up Refinements
11. "make them darker" (after "dresses in light colors")
12. "not red" (after "red dresses")
13. "any color except blue" (after "blue dresses for kids")
14. "more vibrant" (after "pink dresses for baby")
15. "not black or navy" (after "navy blue dresses")

### Edge Cases
16. "dresses in any colour, not red"
17. "red dresses, not cherry red"
18. "blue dresses for kids, not navy"
19. "dresses in light colours, not white"
20. "pink dresses for baby, not floral pattern"

---

## Test Set 3: Multi-Constraint Complex Queries
**Purpose**: Test multiple constraints together (age + color + price + occasion + material)

### Complex Queries
1. "red dresses for kids under $100"
2. "baby clothes in pink, not cotton"
3. "teenage dresses for prom, not black, under $200"
4. "toddler outfits in any color, not red, cotton only"
5. "dresses for kids, pink or blue, under $80, not floral"
6. "baby girl clothes, not pink, organic materials"
7. "teenage dresses for graduation, not formal, under $150"
8. "tween dresses, not red or black, casual style"
9. "adult dresses for wedding, not white, under $300"
10. "kids dresses, any color except red, not cotton, under $60"

### Follow-up Refinements
11. "make them cheaper" (after "red dresses for kids under $100")
12. "change to blue" (after "baby clothes in pink, not cotton")
13. "add floral pattern" (after "teenage dresses for prom, not black, under $200")
14. "remove price limit" (after "toddler outfits in any color, not red, cotton only")
15. "make them more formal" (after "dresses for kids, pink or blue, under $80, not floral")

---

## Test Set 4: Follow-up Refinement & Constraint Merging
**Purpose**: Test follow-up queries, constraint merging, and context preservation

### Initial Query + Follow-ups
1. **Initial**: "dresses for kids"
   - Follow-up 1: "make them pink"
   - Follow-up 2: "under $100"
   - Follow-up 3: "not red"
   - Follow-up 4: "add floral pattern"

2. **Initial**: "baby clothes"
   - Follow-up 1: "in blue"
   - Follow-up 2: "not cotton"
   - Follow-up 3: "under $50"
   - Follow-up 4: "make them more casual"

3. **Initial**: "teenage dresses"
   - Follow-up 1: "for prom"
   - Follow-up 2: "not black"
   - Follow-up 3: "under $200"
   - Follow-up 4: "add sequins"

4. **Initial**: "toddler outfits"
   - Follow-up 1: "in any color"
   - Follow-up 2: "not red"
   - Follow-up 3: "cotton only"
   - Follow-up 4: "under $40"

5. **Initial**: "dresses for a 5-year-old"
   - Follow-up 1: "pink or blue"
   - Follow-up 2: "not floral"
   - Follow-up 3: "under $80"
   - Follow-up 4: "more formal"

### Constraint Removal Tests
6. **Initial**: "red dresses for kids under $100"
   - Follow-up 1: "price doesn't matter"
   - Follow-up 2: "any color"
   - Follow-up 3: "not red"

7. **Initial**: "baby clothes in pink, not cotton"
   - Follow-up 1: "any material"
   - Follow-up 2: "any color"
   - Follow-up 3: "not pink"

---

## Test Set 5: Edge Cases & Boundary Conditions
**Purpose**: Test edge cases, boundary conditions, and error handling

### Age Group Edge Cases
1. "dresses for 18-year-old" (should match Teen, Adult)
2. "clothes for 12-year-old" (should match Kids, Tween, Teen)
3. "baby clothes for 6-month-old"
4. "toddler clothes for 2-year-old"
5. "kids clothes for 10-year-old"

### Color Edge Cases
6. "dresses in cherry red" (should match red)
7. "dresses in burgundy" (should match red family)
8. "dresses in light pink" (should match pink)
9. "dresses in navy blue" (should match blue)
10. "dresses in ivory" (should match white/cream)

### Excluded Constraint Edge Cases
11. "dresses for kids, not red, not blue, not green"
12. "baby clothes, not cotton, not polyester"
13. "teenage dresses, not black, not navy, not formal"
14. "toddler outfits, not red, not floral, not cotton"
15. "dresses for a 5-year-old, not pink, not blue, not floral, not cotton"

### Complex Exclusion Combinations
16. "dresses for kids in any color, not red, not floral pattern, not cotton material"
17. "baby clothes, not pink, not blue, not cotton, under $50"
18. "teenage dresses for prom, not black, not navy, not formal style, under $200"
19. "toddler outfits, not red, not blue, not green, not cotton, not polyester"
20. "dresses for a 5-year-old, not pink, not blue, not floral, not cotton, not under $30"

### Boundary Price Tests
21. "dresses for kids under $1" (should return 0 results)
22. "baby clothes under $10"
23. "teenage dresses under $50"
24. "toddler outfits under $20"
25. "dresses for a 5-year-old under $5"

### Category + Age Group Combinations
26. "swimwear for kids"
27. "swimwear for baby"
28. "activewear for teenagers"
29. "loungewear for kids"
30. "pajamas for baby"

---

## Test Execution Guide

### How to Run Tests

1. **Manual Testing**: Use the chat interface to test each query
2. **Automated Testing**: Create a script to send queries and verify responses
3. **Log Analysis**: Check logs for:
   - Age group normalization
   - Color filtering (hard vs soft)
   - Excluded constraint handling
   - Constraint merging in follow-ups
   - SQL query generation
   - Result counts

### Expected Behaviors

1. **Age Groups**: Should always be hard filters when explicitly mentioned
2. **Colors**: Should be hard filters when explicitly mentioned (not vague like "light colors")
3. **Excluded Constraints**: Should filter out matching products
4. **Follow-ups**: Should preserve previous constraints unless explicitly changed
5. **Price**: Should filter at SQL level
6. **Combinations**: All constraints should work together correctly

### Success Criteria

- ✅ Age groups are normalized to exact dataset values
- ✅ Age groups are applied as hard filters (no results if no match)
- ✅ Colors are applied as hard filters when explicit
- ✅ Excluded constraints filter out matching products
- ✅ Follow-ups preserve context correctly
- ✅ Complex multi-constraint queries work correctly
- ✅ Edge cases don't crash the system
- ✅ SQL queries are generated correctly
- ✅ Results match the constraints

### Failure Indicators

- ❌ Age groups not normalized (lowercase values in database queries)
- ❌ Age groups not applied as hard filters (wrong age products shown)
- ❌ Colors not applied as hard filters (wrong color products shown)
- ❌ Excluded constraints not working (excluded products still shown)
- ❌ Follow-ups losing context (previous constraints dropped)
- ❌ SQL errors or crashes
- ❌ No results when there should be results
- ❌ Wrong results matching constraints


