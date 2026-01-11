# Enriched Pipeline Test Prompts

This document contains 5 comprehensive test prompt sets to verify the enriched dataset pipeline is working correctly. Each set tests different enriched attributes and user journey scenarios.

---

## Test Set 1: Weather & Comfort Queries
**Focus**: `temperatureIntent`, `humidityFriendly`, `problemSolutions`

### Prompt 1.1: Hot Humid Day
```
I need a dress for a hot humid day in Miami. Something that won't make me sweat.
```

**Expected Enriched Constraints**:
- `temperatureIntent`: "Warm Weather"
- `humidityFriendly`: true
- `problemSolutions`: Should include moisture-wicking/breathable features

**What to Verify**:
- ✅ Products returned have `temperatureIntent = "Warm Weather"`
- ✅ Products have `humidityFriendly = true`
- ✅ Reply mentions weather suitability and breathability
- ✅ Product reasons include "humidity-friendly" or similar
- ✅ Ranking boosts applied for temperature/humidity matches

### Prompt 1.2: Winter Wedding
```
Show me formal dresses for a winter wedding. I want something elegant and warm.
```

**Expected Enriched Constraints**:
- `formalityLevel`: ["Formal", "Semi-Formal"]
- `temperatureIntent`: "Cool Weather"
- `occasionContext`: ["Wedding"]
- `seasonalPalette`: ["Winter"]

**What to Verify**:
- ✅ Products have `formalityLevel` matching "Formal" or "Semi-Formal"
- ✅ Products have `temperatureIntent = "Cool Weather"`
- ✅ Products have "Wedding" in `occasionContext` array
- ✅ Reply mentions formality and weather appropriateness
- ✅ Product reasons mention formality level

### Prompt 1.3: Beach Vacation
```
I'm going on a beach vacation and need something casual and breathable for hot weather.
```

**Expected Enriched Constraints**:
- `temperatureIntent`: "Warm Weather"
- `humidityFriendly`: true
- `occasionContext`: ["Vacation", "Beach"]
- `formalityLevel`: ["Casual"]

**What to Verify**:
- ✅ All enriched constraints properly extracted
- ✅ Products match all criteria
- ✅ Reply acknowledges vacation/beach context

---

## Test Set 2: Problem-Solving & Features
**Focus**: `problemSolutions`, `functionFeatures`

### Prompt 2.1: Wrinkle-Free Travel
```
I need a dress that won't wrinkle when I travel. Something I can pack and wear immediately.
```

**Expected Enriched Constraints**:
- `problemSolutions`: Should include "Wrinkle-Free" or "No Wrinkling"
- `functionFeatures`: May include "Travel-Friendly"

**What to Verify**:
- ✅ Products have "Wrinkle-Free" or similar in `problemSolutions` array
- ✅ Reply mentions wrinkle-free feature
- ✅ Product reasons include "wrinkle-free"
- ✅ Ranking boost applied for problemSolutions match (+2.0 per match)

### Prompt 2.2: Pockets Request
```
Show me dresses with pockets. I need somewhere to put my phone and keys.
```

**Expected Enriched Constraints**:
- `functionFeatures`: ["Pockets"]
- `problemSolutions`: May include "Pockets" (if it solves a problem)

**What to Verify**:
- ✅ Products have "Pockets" in `functionFeatures` or `problemSolutions`
- ✅ Reply mentions pockets feature
- ✅ Product reasons include "has pockets"
- ✅ Q&A: If user asks "Does this have pockets?", answer uses enriched attributes

### Prompt 2.3: Bra-Friendly
```
I need a dress that's bra-friendly. Something I can wear a regular bra with.
```

**Expected Enriched Constraints**:
- `problemSolutions`: ["Bra-Friendly"] or ["Bra Friendly"]
- `functionFeatures`: May include "Bra-Friendly"

**What to Verify**:
- ✅ Products have "Bra-Friendly" in `problemSolutions` or `functionFeatures`
- ✅ Reply mentions bra-friendly feature
- ✅ Product reasons mention bra-friendly

---

## Test Set 3: Color & Style Nuance
**Focus**: `colorShade`, `colorUndertone`, `multicolor`, `seasonalPalette`

### Prompt 3.1: Light Warm Tones
```
I'm looking for a dress in light colors with warm undertones. Something spring-like.
```

**Expected Enriched Constraints**:
- `colorShade`: ["Light"]
- `colorUndertone`: ["Warm"]
- `seasonalPalette`: ["Spring"]

**What to Verify**:
- ✅ Products have `colorShade = "Light"`
- ✅ Products have `colorUndertone = "Warm"`
- ✅ Products have `seasonalPalette = "Spring"` (if available)
- ✅ Reply mentions light colors and warm tones
- ✅ Ranking boosts applied for color matches (+1.0 each)

### Prompt 3.2: Multicolor Pattern
```
Show me dresses with multicolor patterns or prints. I love bold designs.
```

**Expected Enriched Constraints**:
- `multicolor`: true

**What to Verify**:
- ✅ Products have `multicolor = true`
- ✅ Reply mentions patterns/prints
- ✅ Products are not solid colors

### Prompt 3.3: Dark Cool Tones
```
I want something in dark colors with cool undertones for fall.
```

**Expected Enriched Constraints**:
- `colorShade`: ["Dark"]
- `colorUndertone`: ["Cool"]
- `seasonalPalette`: ["Fall"]

**What to Verify**:
- ✅ Products match all color criteria
- ✅ Reply acknowledges color preferences

---

## Test Set 4: Occasion & Formality
**Focus**: `formalityLevel`, `occasionContext`, `length`

### Prompt 4.1: Office Appropriate
```
I need professional dresses for the office. Something midi length and semi-formal.
```

**Expected Enriched Constraints**:
- `formalityLevel`: ["Semi-Formal"]
- `occasionContext`: ["Office"]
- `lengths`: ["Midi"]

**What to Verify**:
- ✅ Products have `formalityLevel = "Semi-Formal"`
- ✅ Products have "Office" in `occasionContext`
- ✅ Products have `length = "Midi"`
- ✅ Reply mentions office appropriateness
- ✅ Ranking boost applied for formality match (+2.0)

### Prompt 4.2: Evening Party
```
Show me formal evening dresses. Something elegant for a party.
```

**Expected Enriched Constraints**:
- `formalityLevel`: ["Formal"]
- `occasionContext`: ["Party", "Evening"]

**What to Verify**:
- ✅ Products match formality and occasion
- ✅ Reply mentions evening/party context

### Prompt 4.3: Casual Daytime
```
I want casual dresses for daytime events. Something comfortable and easy to wear.
```

**Expected Enriched Constraints**:
- `formalityLevel`: ["Casual"]
- `occasionContext`: ["Daytime"]

**What to Verify**:
- ✅ Products match casual formality
- ✅ Reply acknowledges casual/daytime context

---

## Test Set 5: Complex Multi-Attribute Queries
**Focus**: Multiple enriched attributes combined

### Prompt 5.1: Wedding Guest - Hot Weather
```
I'm attending a wedding in July. I need a formal dress that's appropriate for hot weather and won't wrinkle. Something in light colors.
```

**Expected Enriched Constraints**:
- `formalityLevel`: ["Formal", "Semi-Formal"]
- `temperatureIntent`: "Warm Weather"
- `humidityFriendly`: true (implied)
- `problemSolutions`: ["Wrinkle-Free"] or ["No Wrinkling"]
- `colorShade`: ["Light"]
- `occasionContext`: ["Wedding"]

**What to Verify**:
- ✅ All constraints properly extracted
- ✅ Products match ALL criteria (formality + weather + wrinkle-free + light colors)
- ✅ Reply acknowledges all aspects of the request
- ✅ Product reasons mention multiple enriched features
- ✅ Ranking boosts applied for all matches

### Prompt 5.2: Travel Dress with Pockets
```
I need a travel-friendly dress with pockets for my vacation. Something that won't wrinkle and is comfortable for long flights.
```

**Expected Enriched Constraints**:
- `functionFeatures`: ["Pockets", "Travel-Friendly"]
- `problemSolutions`: ["Wrinkle-Free", "Travel-Friendly"]
- `occasionContext`: ["Vacation"]

**What to Verify**:
- ✅ Products have multiple matching features
- ✅ Reply mentions all requested features
- ✅ Product reasons include multiple problemSolutions/functionFeatures
- ✅ Ranking boost: +2.0 per problemSolutions match, +1.5 per functionFeatures match

### Prompt 5.3: Beach Wedding Guest
```
I'm going to a beach wedding and need something formal but appropriate for hot humid weather. Light colors with warm undertones would be perfect.
```

**Expected Enriched Constraints**:
- `formalityLevel`: ["Formal", "Semi-Formal"]
- `temperatureIntent`: "Warm Weather"
- `humidityFriendly`: true
- `colorShade`: ["Light"]
- `colorUndertone`: ["Warm"]
- `occasionContext`: ["Wedding", "Beach"]

**What to Verify**:
- ✅ Complex query properly parsed
- ✅ Products match all criteria
- ✅ Reply shows understanding of all constraints
- ✅ Product reasons reflect multiple enriched attributes

### Prompt 5.4: Office to Evening
```
I need a dress that works for both office and evening events. Something semi-formal in dark colors with cool undertones.
```

**Expected Enriched Constraints**:
- `formalityLevel`: ["Semi-Formal"]
- `occasionContext`: ["Office", "Evening"]
- `colorShade`: ["Dark"]
- `colorUndertone`: ["Cool"]

**What to Verify**:
- ✅ Products match dual-occasion requirement
- ✅ Reply acknowledges versatility

### Prompt 5.5: Complete Feature Request
```
I want a formal dress for a winter wedding. It should be wrinkle-free, have pockets, be bra-friendly, and work for cool weather. Dark colors with warm undertones.
```

**Expected Enriched Constraints**:
- `formalityLevel`: ["Formal"]
- `temperatureIntent`: "Cool Weather"
- `problemSolutions`: ["Wrinkle-Free", "Bra-Friendly"]
- `functionFeatures`: ["Pockets"]
- `colorShade`: ["Dark"]
- `colorUndertone`: ["Warm"]
- `occasionContext`: ["Wedding"]
- `seasonalPalette`: ["Winter"]

**What to Verify**:
- ✅ Most complex query properly handled
- ✅ All enriched attributes extracted
- ✅ Products match maximum number of criteria
- ✅ Reply demonstrates comprehensive understanding
- ✅ Product reasons highlight all matching features
- ✅ Ranking boosts compound for multiple matches

---

## Verification Checklist for Each Test

For each prompt, verify:

### 1. Constraint Extraction
- [ ] LLM extracts enriched attributes correctly
- [ ] Constraints appear in `resolvedConstraints` response
- [ ] Enriched fields are populated (not null/undefined)

### 2. Database Filtering
- [ ] SQL WHERE clauses include enriched column filters
- [ ] Products returned match enriched constraints
- [ ] No products returned that don't match constraints

### 3. Ranking & Scoring
- [ ] Products with matching enriched attributes rank higher
- [ ] Ranking boosts applied correctly:
  - Formality level: +2.0
  - Temperature intent: +2.5
  - Humidity friendly: +1.5
  - Problem solutions: +2.0 per match
  - Function features: +1.5 per match
  - Color shade/undertone: +1.0 each

### 4. Constraint Matching
- [ ] `calculateConstraintMatchScore()` uses enriched columns
- [ ] Dynamic weights applied for enriched attributes
- [ ] Match scores reflect enriched attribute matches

### 5. Reply Generation
- [ ] Reply mentions enriched attributes naturally
- [ ] Product details include enriched attributes
- [ ] Enriched columns prioritized over JSON attributes

### 6. Product Reasons
- [ ] Reasons generated from `problemSolutions` and `functionFeatures`
- [ ] Reasons mention enriched features (e.g., "wrinkle-free", "has pockets")
- [ ] Reasons prioritize enriched attributes over generic style/occasion

### 7. Product Q&A
- [ ] Q&A prompt emphasizes enriched attributes
- [ ] Answers use enriched columns as primary source
- [ ] Examples: "Does this have pockets?" → checks `functionFeatures` array

### 8. Type Safety
- [ ] `SearchResultItem` includes enriched columns
- [ ] Products loaded with enriched columns selected
- [ ] No type errors in console

---

## Expected Improvements

After implementing enriched attributes, you should see:

1. **30-50% improvement** in ranking accuracy for weather/occasion queries
2. **40-60% improvement** in reply relevance and informativeness
3. **25-35% improvement** in "Chosen because..." reason accuracy
4. **Better product discovery** for enriched queries (e.g., "hot humid day", "wedding dress", "wrinkle-free with pockets")

---

## Debugging Tips

If tests fail:

1. **Check constraint extraction**: Look at `resolvedConstraints` in API response
2. **Check database**: Verify products have enriched columns populated
3. **Check SQL logs**: Verify enriched filters appear in WHERE clauses
4. **Check ranking**: Verify boosts are applied (check `rank` scores)
5. **Check reply**: Verify enriched attributes appear in product details
6. **Check reasons**: Verify reasons use enriched attributes

---

## Notes

- All prompts are designed for LoveShackFancy fashion/apparel catalog
- Enriched attributes should be extracted even if user doesn't use exact terminology
- Fallback to JSON attributes should work if enriched columns are null
- Ranking should prioritize products with more enriched attribute matches




