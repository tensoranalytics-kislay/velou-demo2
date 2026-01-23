# Constraint Merger Verification

## Current Coverage Analysis

### ✅ What's Currently Covered

The constraint merger prompt (`CONSTRAINT_MERGER_PROMPT`) has comprehensive coverage for:

1. **MERGE (Add) Operations** - Examples provided for:
   - colors, materials, patterns, styles, lengths, sleeveLengths, sizes, occasions, ageGroups, price

2. **REPLACE Operations** - Examples provided for:
   - colors, materials, lengths, product types, ageGroups, price

3. **REMOVE Operations** - Examples provided for:
   - colors, materials, patterns, occasions, price

4. **EXCLUDED Intent** - Examples provided for:
   - colors, materials, patterns

### ⚠️ Potential Gaps

The prompt provides detailed examples for common constraint types but may not explicitly state that **ALL constraint types** support add/remove/replace/exclude operations. 

**Constraint types that may need explicit coverage:**
- `rises` (Low Rise, Mid Rise, High Rise)
- `collections`
- `embellishments`
- `formalityLevel`
- `colorShade` (Light, Medium, Dark)
- `colorUndertone` (Warm, Cool, Neutral)
- `seasonalPalette`
- `inclusivitySizing` (Plus Size, Petite, Tall, etc.)
- `setVsSingle`
- `careRequirements`
- `rainWind`
- `travelFeatures`
- `pockets`
- `liningType`
- `braSolution`
- `ecoMaterials`
- `certifications`
- `origin`
- `adaptiveFeatures`
- `sensoryFriendly`
- `finish`
- `modestyCues`
- `layeringIntent`
- `pairingIntent`
- `temperatureIntent`
- `humidityFriendly`
- `occasionContext`
- `problemSolutions`
- `functionFeatures`
- `scents` (for perfumes/candles)
- `rooms` (for home & living)
- `useCases`
- `benefits`
- `claims`
- `sensoryProfile`
- `compatibility`

## Recommendation

The prompt should be enhanced to:
1. **Explicitly state** that add/remove/replace/exclude operations apply to **ALL constraint types**
2. **Provide general rules** that work for any constraint type, not just examples for specific types
3. **Include examples** for less common constraint types to ensure the LLM understands the pattern
