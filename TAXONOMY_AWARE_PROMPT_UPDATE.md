# Taxonomy-Aware Constraint Extraction Prompt Update

## Overview

Updated the constraint extraction prompt to use the exact dataset taxonomy instead of generic categories. The new prompt enforces strict category matching and includes sophisticated synonym normalization.

## Changes Made

### 1. Updated `INTENT_AND_CONSTRAINTS_PROMPT`

**Before:**
- Generic categories: "Dresses", "Tops", "Pants", "Outerwear", "Skirts"
- No taxonomy structure
- Basic constraint extraction

**After:**
- Exact dataset taxonomy: hierarchical structure `top_level > sub_level > leaf`
- Valid top_level: `["mens", "womens", "accessories"]`
- Specific sub/leaf values with examples
- Synonym normalization rules
- Material normalization (canonical tokens)
- Color normalization with marketing names
- Context carryover logic (carry/override/reset)

### 2. Updated `SEARCH_CONSTRAINTS_JSON_SCHEMA`

**New Required Fields:**
- `contextAction`: "carry" | "override" | "reset"
- `query`: string (top-level, for soft scoring)

**Updated Fields:**
- `intent`: "discovery" | "other" | "pdp_suitability" (backward compatible)
- `constraints`: All fields now nullable (can be `null`)

### 3. Updated Parsing Logic

**`inferIntentAndConstraintsWithLlm`:**
- Handles new schema format with `contextAction` and `query`
- Maps "other" intent to "discovery"
- Uses `query` from LLM response if provided
- Handles `contextAction` for merging decisions

**User Message Format:**
- Now includes `latest_user_message`, `previous_constraints`, `previous_user_message`
- Matches the prompt's expected input format

## Taxonomy Rules

### Category Structure
- **Top Level**: `mens`, `womens`, `accessories`
- **Sub/Leaf Examples**:
  - mens: `t shirt`, `shirt`, `jeans`, `pants`, `shorts`, `sweaters`, `outerwear`, `blazer`
  - womens: `t shirt`, `shirt`, `woven tops`, `knit tops`, `jeans`, `pants`, `shorts`, `skirts`, `dresses`, `jumpsuits`
  - accessories: `bags`, `belts`, `hats`, `scarves`, `jewelry`, `socks`, `shoes`
  - Leaf: `graphic t shirt`, `solid t shirts`, `short sleeve shirt`, `long sleeve shirt`, `sleeveless shirt`, `skinny jeans`, `straight leg jeans`, etc.

### Synonym Normalization
- `tshirt/tee/tees/tee shirt/t-shirts/graphic tee` → `"t shirt"` node, prefer `"graphic t shirt"` leaf if graphic/printed
- `long sleeve/l/s/full sleeve` → `"long sleeve shirt"` leaf
- `short sleeve/s/s/half sleeve` → `"short sleeve shirt"` leaf
- `tank/sleeveless/muscle tee` → `"sleeveless shirt"` leaf
- `denim` → bias to nodes/leafs containing jeans/denim shorts/skirts
- `skirt/skirts` → node or leaf `"skirts"`
- `bag/handbag/purse/tote/crossbody` → node `"bags"` plus closest leaf
- `belt/belts` → node `"belts"`
- `shoes/sneakers/boots/sandals` → node `"shoes"` plus leaf if specified

### Material Normalization
Canonical tokens: `["cotton","poly","elastane","lyocell","viscose","rayon","nylon","acrylic","linen","wool","spandex"]`
- `polyester/poly` → `"poly"`
- `spandex/stretch/elastane` → `"elastane"`
- `tencel` → `"lyocell"`

### Color Normalization
- Base colors match ANY catalog color containing that base word
- Marketing names: black-family `["caviar","raven","meteorite","ironclad"]`, navy-family `["dress blues"]`, burgundy-family `["malbec"]`
- User-provided marketing names kept as-is

## Context Carryover Logic

### OVERRIDE / RESET
Triggers when message:
- Explicitly changes item type/category
- Keywords: `["instead","show me X","only X","just X","rather","not that"]`
- Narrows to specific product type

### CARRY CONTEXT
Triggers when message:
- References "those", "them", "ones like that", "in that vibe", "same style"
- Adds attributes only (color, fabric, price, size) without changing product type

### Default
- If unsure, default to CARRY but NEVER keep constraints that conflict with new category

## Output Format

```json
{
  "intent": "discovery" | "other",
  "contextAction": "carry" | "override" | "reset",
  "constraints": {
    "category": "<exact dataset node or leaf string or undefined>",
    "priceMinCents": <number or undefined>,
    "priceMaxCents": <number or undefined>,
    "fabrics": <array or undefined>,
    "colors": <array or undefined>,
    "seasons": <array or undefined>,
    "occasions": <array or undefined>,
    "sizes": <array or undefined>,
    "fit": <string or undefined>,
    "brands": <array or undefined>,
    "genders": <array ["mens","womens","unisex"] or undefined>,
    "materials": <array of canonical tokens or undefined>,
    "inStockOnly": true
  },
  "query": "<short soft-scoring text using normalized synonyms>"
}
```

## Files Changed

1. **`src/lib/llm/prompts.ts`**
   - Updated `INTENT_AND_CONSTRAINTS_PROMPT` with taxonomy rules
   - Updated `SEARCH_CONSTRAINTS_JSON_SCHEMA` with new fields

2. **`src/lib/llm/orchestrator/intent.ts`**
   - Updated `inferIntentAndConstraintsWithLlm` to handle new schema
   - Updated user message format to match prompt expectations
   - Added handling for `contextAction` and `query` fields

## Benefits

1. **Exact Taxonomy Matching**: Categories must match dataset exactly
2. **Better Synonym Handling**: Normalizes common variations to exact terms
3. **Material Normalization**: Maps user terms to canonical DB tokens
4. **Color Intelligence**: Handles marketing names and base color matching
5. **Context Awareness**: Explicit carry/override/reset logic
6. **Query Text**: Separate query field for soft scoring

## Verification

- ✅ TypeScript compilation: PASSED (orchestrator files)
- ✅ Schema updated: New fields added
- ✅ Parsing logic: Handles new format
- ✅ Backward compatibility: Still handles "pdp_suitability" intent

## Next Steps

1. Test with real queries to verify taxonomy matching
2. Monitor LLM outputs to ensure categories match dataset
3. Fine-tune synonym normalization if needed
4. Verify material/color normalization works correctly


