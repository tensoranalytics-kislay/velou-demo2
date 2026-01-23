# Array vs Intent Format Explanation

## The Problem

When the LLM extracts constraints, it can return them in **two different formats**:

### ❌ **Array Format (No Intent)** - INCORRECT for directly interpretable constraints

```json
{
  "styles": ["Empire"]
}
```

**What this means:**
- Just a plain array of values
- **No intent information** (no `intent` field)
- The system doesn't know if this should be:
  - A **hard SQL filter** (must match exactly)
  - A **soft ranking preference** (preferred but not required)

**What happens:**
- These constraints are **only used for ranking** (soft preference)
- They are **NOT applied as hard SQL filters**
- Products that don't match can still appear in results (just ranked lower)

### ✅ **Intent Format (With Intent)** - CORRECT for directly interpretable constraints

```json
{
  "styles": { 
    "values": ["Empire Waist"], 
    "intent": "required" 
  }
}
```

**What this means:**
- Has both `values` (the constraint values) and `intent` (how strict to apply it)
- `intent` can be:
  - `"required"` → Hard SQL filter (must match exactly)
  - `"strong"` → Soft ranking preference (highly preferred)
  - `"preferred"` → Soft ranking preference (nice to have)
  - `"excluded"` → Hard SQL filter (must NOT match)

**What happens:**
- If `intent: "required"` → Applied as **hard SQL filter** (only matching products retrieved)
- If `intent: "strong"` or `"preferred"` → Used for **ranking** (all products retrieved, but matching ones ranked higher)

## Real Examples from the Logs

### Example 1: "empire waist dresses" ❌ (Array Format)

**What the LLM returned:**
```json
{
  "styles": ["Empire"]
}
```

**Problems:**
1. ❌ Missing intent format (should be `{ values: [...], intent: "required" }`)
2. ❌ Value mismatch: "Empire" instead of "Empire Waist" (dictionary value)
3. ❌ Not applied as hard SQL filter (only used for ranking)

**What should have been returned:**
```json
{
  "styles": { 
    "values": ["Empire Waist"], 
    "intent": "required" 
  }
}
```

### Example 2: "cap sleeve dress" ✅ (Intent Format)

**What the LLM returned:**
```json
{
  "sleeveLengths": { 
    "values": ["Cap Sleeve"], 
    "intent": "required" 
  }
}
```

**Why this is correct:**
1. ✅ Uses intent format with `values` and `intent`
2. ✅ Intent is `"required"` (direct interpretation → hard filter)
3. ✅ Will be applied as hard SQL filter (only Cap Sleeve products retrieved)

### Example 3: "scoop neck blouse" ❌ (Array Format)

**What the LLM returned:**
```json
{
  "necklines": ["Scoop"]
}
```

**Problems:**
1. ❌ Missing intent format (should be `{ values: [...], intent: "required" }`)
2. ❌ Not applied as hard SQL filter (only used for ranking)

**What should have been returned:**
```json
{
  "necklines": { 
    "values": ["Scoop"], 
    "intent": "required" 
  }
}
```

### Example 4: "fit and flare style dresses" ❌ (Array Format)

**What the LLM returned:**
```json
{
  "styles": ["Fit and Flare"]
}
```

**Problems:**
1. ❌ Missing intent format (should be `{ values: [...], intent: "required" }`)
2. ❌ Not applied as hard SQL filter (only used for ranking)

**What should have been returned:**
```json
{
  "styles": { 
    "values": ["Fit and Flare"], 
    "intent": "required" 
  }
}
```

## Why This Matters

### Impact on Search Results

**With Array Format (No Intent):**
- Query: "show me empire waist dresses"
- LLM extracts: `styles: ["Empire"]`
- System behavior:
  - Retrieves ALL dresses (no hard filter)
  - Ranks Empire Waist dresses higher (soft preference)
  - **Problem**: Non-Empire Waist dresses can still appear in top results

**With Intent Format (Required Intent):**
- Query: "show me empire waist dresses"
- LLM extracts: `styles: { values: ["Empire Waist"], intent: "required" }`
- System behavior:
  - **Hard SQL filter**: Only retrieves Empire Waist dresses
  - Ranks them by other criteria (price, color, etc.)
  - **Result**: Only Empire Waist dresses appear (more accurate)

## The Fix

The prompt has been updated to emphasize:

1. **ALL directly interpretable constraints** (including synonyms) **MUST use intent format**
2. **Synonyms are direct interpretations** → Always `"required"` intent
3. **Examples added** for styles and necklines with synonyms

**Before (Old Prompt):**
```
"styles": string[] | null
```

**After (Updated Prompt):**
```
"styles": { "values": ["A-Line"], "intent": "required" } | null
// ✅ Use intent format for direct interpretation
// ❌ NOT styles: ["A-Line"]
```

## Summary

- **Array format** = `["Value"]` → No intent info → Only used for ranking
- **Intent format** = `{ values: ["Value"], intent: "required" }` → Has intent info → Can be used as hard filter

For directly interpretable constraints (including synonyms), we **always need intent format** with `"required"` intent to ensure accurate filtering.
