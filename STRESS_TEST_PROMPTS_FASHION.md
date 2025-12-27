# Stress Test Prompts for Fashion Shopping Assistant

This document contains 8 comprehensive test sets designed to stress test each core capability of the LoveShackFancy fashion shopping assistant.

## Test Set 1: Discovery Queries - Multi-Attribute Product Search
**Capability**: Natural language product discovery with multiple fashion-specific attributes

### Initial Query
```
"Show me a floral maxi dress for a beach wedding under $400"
```

**Expected Behavior**:
- Extract: category="Women's Dresses" or "Maxi Dress", pattern="Floral", occasion="Beach Wedding", priceMaxCents=40000
- Should return relevant maxi dresses with floral patterns suitable for beach weddings
- Reply should acknowledge the occasion and style preferences

### Follow-up 1: Style Refinement
```
"Make it more casual, like something I could wear to a daytime brunch"
```

**Expected Behavior**:
- Should maintain category (dresses), update occasion to "Daytime" or "Casual"
- May relax or adjust pattern constraint if needed
- Should carry forward price constraint

### Follow-up 2: Length Adjustment
```
"Actually, I prefer a mini dress instead"
```

**Expected Behavior**:
- Should update length constraint from "Maxi" to "Mini"
- Maintain other constraints (pattern, occasion, price)
- May need to adjust category to "Mini Dress" if catalog distinguishes

### Follow-up 3: Color Addition
```
"Show me it in white or cream"
```

**Expected Behavior**:
- Should add colors=["White", "Cream"] constraint
- Maintain all previous constraints
- Filter results to white/cream floral mini dresses

---

## Test Set 2: Context Carry-Over and Constraint Merging
**Capability**: Maintaining conversation context across multiple refinements

### Initial Query
```
"I need something elegant for a formal evening event"
```

**Expected Behavior**:
- Extract: occasion="Evening" or "Formal", styleTags=["elegant"]
- May need to ask clarifying questions or show broad results

### Follow-up 1: Category Specification
```
"Show me dresses"
```

**Expected Behavior**:
- Should add category="Women's Dresses"
- Maintain occasion="Evening" and styleTags=["elegant"]
- Merge constraints: elegant evening dresses

### Follow-up 2: Price Constraint
```
"Under $500"
```

**Expected Behavior**:
- Should add priceMaxCents=50000
- Maintain all previous constraints
- Filter to elegant evening dresses under $500

### Follow-up 3: Material Preference
```
"Preferably silk or chiffon"
```

**Expected Behavior**:
- Should add materials=["Silk", "Chiffon"] or fabrics=["Silk", "Chiffon"]
- Maintain category, occasion, style, price
- Complete constraint set: elegant evening dresses, silk/chiffon, under $500

### Follow-up 4: Size Addition
```
"Size 6"
```

**Expected Behavior**:
- Should add sizes=["6"]
- All previous constraints maintained
- Final search: elegant evening dresses, silk/chiffon, size 6, under $500

---

## Test Set 3: Category Switching Detection
**Capability**: Distinguishing between follow-up refinements and new searches

### Initial Query
```
"Show me tops under $200"
```

**Expected Behavior**:
- Extract: category="Tops", priceMaxCents=20000
- Should return tops under $200

### Follow-up 1: Refinement (Should be FOLLOW-UP)
```
"Make it black"
```

**Expected Behavior**:
- threadType="follow_up"
- Should add colors=["Black"]
- Maintain category="Tops" and price constraint
- Result: black tops under $200

### Follow-up 2: Category Change (Should be NEW_SEARCH)
```
"Actually, show me swimsuits instead"
```

**Expected Behavior**:
- threadType="new_search"
- Should reset category to "Swimsuits" or "Bikini Sets"
- May keep price constraint or reset (depends on implementation)
- Should NOT carry forward color constraint unless explicitly mentioned

### Follow-up 3: Refinement After Category Switch (Should be FOLLOW-UP)
```
"Under $150"
```

**Expected Behavior**:
- threadType="follow_up"
- Should update priceMaxCents=15000 for swimsuits
- Maintain category="Swimsuits"
- Result: swimsuits under $150

### Follow-up 4: Another Category Change (Should be NEW_SEARCH)
```
"Now show me loungewear"
```

**Expected Behavior**:
- threadType="new_search"
- Should reset to category="Loungewear"
- May keep price constraint or start fresh
- Should NOT carry forward swimsuit-specific context

---

## Test Set 4: Vague and Underspecified Queries
**Capability**: Handling unclear requests and asking clarifying questions

### Initial Query
```
"Something nice for summer"
```

**Expected Behavior**:
- Should recognize as vague/underspecified
- May ask clarifying questions OR show broad summer-appropriate results
- Extract: seasons=["Summer"] (if possible)
- Should not over-constrain the search

### Follow-up 1: Partial Clarification
```
"Dresses"
```

**Expected Behavior**:
- Should add category="Women's Dresses"
- Maintain season="Summer"
- Narrow results to summer dresses

### Follow-up 2: Still Vague
```
"Something I can wear to the beach"
```

**Expected Behavior**:
- Should add occasion="Beach" or useCases=["beach"]
- May need to suggest swimwear, cover-ups, or beach-appropriate dresses
- Maintain category and season if still relevant

### Follow-up 3: More Specific
```
"Floral patterns, under $300"
```

**Expected Behavior**:
- Should add pattern="Floral" and priceMaxCents=30000
- Maintain category, season, occasion
- Final: summer beach dresses, floral, under $300

---

## Test Set 5: PDP Suitability Queries
**Capability**: Product-specific Q&A and suitability assessment

### Initial Query (Discovery)
```
"Show me mini dresses"
```

**Expected Behavior**:
- Extract: category="Mini Dress" or length="Mini"
- Should return mini dresses with product cards

### Follow-up 1: Product-Specific Question (PDP Context)
```
"Is the first one appropriate for a wedding?"
```

**Expected Behavior**:
- Should detect intent="pdp_suitability" if productContextId is provided
- Evaluate the specific product's attributes (occasion, style, formality)
- Provide honest assessment based on product data only
- Reference actual attributes like occasion tags, style, embellishments

### Follow-up 2: Another Product Question
```
"What about for the office?"
```

**Expected Behavior**:
- Should evaluate same or different product for office appropriateness
- Check occasion="Office" compatibility
- Consider style, length, formality level
- Be honest if product doesn't match office dress code

### Follow-up 3: Material Question
```
"Does it wrinkle easily?"
```

**Expected Behavior**:
- Should check product's material/fabric attributes
- Reference care instructions if available
- Provide answer based on material properties (e.g., linen wrinkles, polyester doesn't)
- Only reference information present in product data

---

## Test Set 6: Constraint Relaxation and No-Results Handling
**Capability**: Handling over-constrained queries and finding closest matches

### Initial Query (Over-Constrained)
```
"Show me a red silk maxi dress with long sleeves, v-neck, floral pattern, under $200, size 4, for a formal wedding"
```

**Expected Behavior**:
- Extract all constraints: category="Maxi Dress", colors=["Red"], materials=["Silk"], sleeveLengths=["Long"], necklines=["V-Neck"], pattern="Floral", priceMaxCents=20000, sizes=["4"], occasion="Formal" or "Wedding"
- If no exact matches, should:
  - Attempt rescue search by relaxing less critical constraints
  - Show closest matches with explanation
  - Ask which constraints can be relaxed

### Follow-up 1: Explicit Relaxation Request
```
"Show me close matches, price can be higher"
```

**Expected Behavior**:
- Should relax priceMaxCents constraint
- Maintain other core constraints (category, color, material, size)
- Show products that match most criteria but exceed price

### Follow-up 2: Further Relaxation
```
"Actually, any neckline is fine"
```

**Expected Behavior**:
- Should remove necklines constraint
- Maintain: red silk maxi dress, long sleeves, floral, size 4, formal wedding
- Broaden results by removing neckline filter

### Follow-up 3: Pattern Flexibility
```
"Floral or solid is okay"
```

**Expected Behavior**:
- Should expand pattern constraint to include "Solid"
- Or remove pattern constraint entirely
- Final relaxed search: red silk maxi dress, long sleeves, size 4, formal wedding, any pattern

---

## Test Set 7: Complex Multi-Attribute Fashion Queries
**Capability**: Handling fashion-specific attributes (style, fit, embellishments, collections)

### Initial Query
```
"I'm looking for a fitted A-line dress with lace embellishments for a holiday party"
```

**Expected Behavior**:
- Extract: category="Women's Dresses", fits=["Fitted"], styles=["A-Line"], embellishments=["Lace"], occasion="Holiday" or "Party"
- Should return dresses matching these specific fashion attributes
- Reply should acknowledge the style and occasion

### Follow-up 1: Collection Preference
```
"From the Holiday collection if available"
```

**Expected Behavior**:
- Should add collections=["Holiday"]
- Maintain all previous constraints
- Filter to Holiday collection items if available

### Follow-up 2: Color and Length
```
"In navy or burgundy, midi length"
```

**Expected Behavior**:
- Should add colors=["Navy", "Burgundy"] and length="Midi"
- Maintain: fitted A-line, lace, holiday party, holiday collection
- Complete constraint set with color and length preferences

### Follow-up 3: Sleeve Preference
```
"With sleeves, not sleeveless"
```

**Expected Behavior**:
- Should add sleeveLengths constraint (exclude "Sleeveless")
- Or specify sleeveLengths=["Short", "Long", "Three Quarter"]
- Final: fitted A-line midi dress, lace, navy/burgundy, sleeves, holiday collection, holiday party

---

## Test Set 8: Long Multi-Turn Conversation with Context Switches
**Capability**: Maintaining and switching context through extended conversations

### Turn 1: Initial Discovery
```
"I need an outfit for a beach wedding"
```

**Expected Behavior**:
- Extract: occasion="Beach Wedding"
- May show dresses, cover-ups, or ask for category preference

### Turn 2: Category Selection
```
"Show me dresses"
```

**Expected Behavior**:
- Add category="Women's Dresses"
- Maintain occasion="Beach Wedding"
- Should be follow_up

### Turn 3: Style Refinement
```
"Something flowy and romantic"
```

**Expected Behavior**:
- Add styleTags=["romantic"] or style descriptors
- Maintain category and occasion
- Should be follow_up

### Turn 4: Price Constraint
```
"Under $350"
```

**Expected Behavior**:
- Add priceMaxCents=35000
- Maintain all previous constraints
- Should be follow_up

### Turn 5: Category Switch (NEW_SEARCH)
```
"Actually, I also need a swimsuit for the trip"
```

**Expected Behavior**:
- threadType="new_search"
- Reset to category="Swimsuits" or "Bikini Sets"
- May keep price or reset
- Should NOT carry forward dress-specific constraints

### Turn 6: Swimsuit Refinement (FOLLOW-UP)
```
"One-piece, under $200"
```

**Expected Behavior**:
- Add product type or style constraint for one-piece
- Add/update priceMaxCents=20000
- Should be follow_up to swimsuit search

### Turn 7: Back to Dresses (NEW_SEARCH)
```
"Back to the dresses - show me maxi length"
```

**Expected Behavior**:
- threadType="new_search" (category change back to dresses)
- Should restore or re-establish dress context
- Add length="Maxi"
- May need to re-apply previous dress constraints (beach wedding, flowy, romantic, under $350)

### Turn 8: Final Refinement (FOLLOW-UP)
```
"In white or ivory"
```

**Expected Behavior**:
- Add colors=["White", "Ivory"]
- Maintain: maxi dresses, beach wedding, flowy/romantic, under $350
- Should be follow_up
- Complete search: white/ivory maxi dresses, flowy romantic style, beach wedding, under $350

---

## Testing Instructions

### For Each Test Set:
1. **Start with a fresh session** - Clear conversation history
2. **Execute prompts sequentially** - Send each message in order
3. **Verify expected behaviors** - Check that the assistant:
   - Correctly extracts constraints
   - Maintains context for follow-ups
   - Detects new searches appropriately
   - Returns relevant products
   - Provides helpful responses

### Key Metrics to Track:
- **Response Time**: Should be under 4 seconds for typical queries
- **Context Accuracy**: Follow-ups should correctly merge constraints
- **Search Relevance**: Products should match the query intent
- **Error Handling**: Should gracefully handle edge cases
- **Thread Type Detection**: Should correctly identify follow_up vs new_search

### Expected Behaviors Summary:
- ✅ Follow-up queries merge constraints with previous context
- ✅ Category switches trigger new_search and reset category
- ✅ Fashion-specific attributes (style, fit, pattern, embellishments) are extracted correctly
- ✅ Price/color/size refinements update constraints without losing context
- ✅ Vague queries trigger clarifying questions or broad results
- ✅ Over-constrained queries trigger relaxation and closest-match suggestions
- ✅ PDP suitability questions evaluate products based on actual attributes
- ✅ Long conversations maintain context correctly through switches
- ✅ Multi-attribute queries handle all fashion-specific fields
- ✅ No results scenarios provide helpful alternatives

---

## Additional Edge Cases to Test

### Ambiguous Pronouns
```
Turn 1: "Show me floral dresses"
Turn 2: "Make it cheaper" → Should refine dresses
Turn 3: "Show me more like that" → Should find similar dresses
```

### Confirmation Responses
```
Turn 1: "Show me beach wedding dresses under $400"
Turn 2: "Yes, show me those" → Should confirm and show results
Turn 3: "Make it maxi length" → Should refine the confirmed search
```

### Negative Constraints
```
Turn 1: "Show me dresses"
Turn 2: "Not black" → Should exclude black
Turn 3: "And not too formal" → Should exclude formal occasion tags
```

### Collection + Multiple Attributes
```
Turn 1: "Show me items from the Spring Collection"
Turn 2: "Dresses only, floral patterns"
Turn 3: "Under $300, size 6"
```

### Rapid Context Switching
```
Turn 1: "Show me tops"
Turn 2: "Now swimsuits"
Turn 3: "Back to tops"
Turn 4: "Under $150"
```




