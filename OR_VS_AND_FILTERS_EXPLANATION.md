# OR vs AND Filters Explanation

## Basic Concepts

### AND Filter (Intersection)
- **All conditions must be true** for a product to match
- Products must satisfy **every** condition
- Example: `category="Dresses" AND gender="female" AND ageGroup="Adult"`
- Result: Only products that match **ALL** conditions

### OR Filter (Union)
- **At least one condition must be true** for a product to match
- Products must satisfy **any** condition
- Example: `color="Red" OR color="Blue" OR color="Green"`
- Result: Products that match **ANY** of the conditions

## In Our Pipeline

### AND Filters (Hard Filters - Must Match ALL)
These filters are combined with **AND** - products must match **ALL** of them:

1. **Category** - Product must be in specified category
2. **Gender** - Product must match specified gender (or unisex)
3. **AgeGroup** - Product must match specified age group
4. **SetVsSingle** - Product must match pack type (default: "Single")
5. **Price** - Product must be within price range (if specified)
6. **Stock** - Product must be in stock
7. **Active** - Product must be active
8. **MerchantId** - Product must belong to specified merchant
9. **InclusivitySizing** - Product must match body type (default: "Standard Sizing")

**SQL Example:**
```sql
WHERE category = 'Dresses' 
  AND gender IN ('female', 'unisex')
  AND ageGroup = 'Adult'
  AND stockStatus = 'in_stock'
  AND isActive = true
```

### OR Filters (Constraint Filters - Match ANY or Missing Data)
These filters use **OR** logic - products show up if they:
- **Match any of the specified values**, OR
- **Don't have the data** (for "strong"/"preferred" intent)

**Within each constraint type**, multiple values are OR'd:
- `color="Red" OR color="Blue" OR color="Green"` → Product matches if it's Red, Blue, OR Green

**Between different constraint types**, they are AND'd:
- `(color="Red" OR color="Blue") AND (formalityLevel="Semi-Formal" OR formalityLevel="Formal")`
- Product must match at least one color **AND** at least one formalityLevel

**SQL Example:**
```sql
WHERE (
  -- Colors: OR within colors, but AND with other constraints
  (color = 'Red' OR color = 'Blue' OR color = 'Green')
) AND (
  -- FormalityLevel: OR within formalityLevel, but AND with other constraints
  (formalityLevel = 'Semi-Formal' OR formalityLevel = 'Formal')
) AND (
  -- Occasions: OR within occasions, but AND with other constraints
  (occasionContext && ARRAY['Work', 'Office']::text[] OR occasion = 'Work')
)
```

## Special Case: Missing Data (OR Behavior)

For constraints with **"strong"** or **"preferred"** intent:
- Products **without** the constraint data still show up (OR behavior)
- Example: If formalityLevel="Semi-Formal" (strong intent), products with:
  - `formalityLevel="Semi-Formal"` → Match ✅
  - `formalityLevel=null` → Also match ✅ (OR behavior - missing data is OK)
  - `formalityLevel="Casual"` → Don't match ❌

For constraints with **"required"** intent:
- Products **must** have the data and match (AND behavior)
- Example: If formalityLevel="Semi-Formal" (required intent), products with:
  - `formalityLevel="Semi-Formal"` → Match ✅
  - `formalityLevel=null` → Don't match ❌ (AND behavior - must have data)
  - `formalityLevel="Casual"` → Don't match ❌

## Current Implementation

### AND Filters (Applied in Pre-Deduplication)
```typescript
// These are AND'd together
WHERE category = 'Dresses'
  AND gender IN ('female', 'unisex')
  AND ageGroup = 'Adult'
  AND stockStatus = 'in_stock'
  AND isActive = true
  AND merchantId = '...'
  AND inclusivitySizing = 'Standard Sizing'
  AND setVsSingle = 'Single'
```

### OR Filters (Applied in Pre-Deduplication for Required Constraints)
```typescript
// Within each constraint type: OR
// Between constraint types: AND
WHERE (
  -- Colors: OR within colors
  (color = 'Red' OR color = 'Blue' OR color = 'Green')
) AND (
  -- FormalityLevel: OR within formalityLevel (if required/strong intent)
  (formalityLevel = 'Semi-Formal' OR formalityLevel = 'Formal')
) AND (
  -- Occasions: OR within occasions (if required/strong intent)
  (occasionContext && ARRAY['Work']::text[] OR occasion = 'Work')
)
```

## Example Query: "I am joining office next month, suggest me a dress to wear"

### Extracted Constraints:
- `occasions: ["Work"]` (required intent) → AND filter
- `formalityLevel: ["Semi-Formal"]` (strong intent) → AND filter (now hard filter)
- `colors: ["White", "Beige", "Navy Blue", "Black", "Gray"]` (strong intent) → OR filter (ranking only, not SQL filtered)

### SQL Filter Applied:
```sql
WHERE category = "Women's Dresses"
  AND gender IN ('female', 'unisex')
  AND ageGroup = 'Adult'
  AND stockStatus = 'in_stock'
  AND isActive = true
  AND (
    -- Occasions: OR within occasions
    occasionContext && ARRAY['Work']::text[] OR occasion = 'Work'
  ) AND (
    -- FormalityLevel: OR within formalityLevel
    formalityLevel = 'Semi-Formal' OR attributes->>'formalityLevel' = 'Semi-Formal'
  )
```

### Result:
- Products must match **ALL** AND filters (category, gender, ageGroup, stock, etc.)
- Products must match **at least one** occasion value (Work)
- Products must match **at least one** formalityLevel value (Semi-Formal)
- Colors are **NOT** SQL filtered (strong intent) - used for ranking only

## Key Takeaway

- **AND filters**: Products must match **ALL** conditions (category, gender, ageGroup, etc.)
- **OR filters**: Products match if they satisfy **ANY** condition within that constraint type
- **Between constraint types**: AND'd together (must match at least one color **AND** at least one formalityLevel)
- **Missing data**: For "strong"/"preferred" intent, products without data still show up (OR behavior in ranking)
