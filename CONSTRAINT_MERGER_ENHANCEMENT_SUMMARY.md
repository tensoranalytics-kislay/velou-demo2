# Constraint Merger Enhancement Summary

## Changes Made

I've enhanced the constraint merger prompt (`CONSTRAINT_MERGER_PROMPT` in `src/lib/loveshackfancy/constraint-merger.ts`) to explicitly state that add/remove/replace/exclude operations apply to **ALL constraint types**, not just the common ones.

### Key Enhancements

1. **Added Universal Operations Section**:
   - New section: "CRITICAL: UNIVERSAL CONSTRAINT OPERATIONS - APPLIES TO ALL CONSTRAINT TYPES"
   - Lists all constraint types (core, enriched, category-specific)
   - Provides general rules that work for any constraint type

2. **General Rules for All Constraint Types**:
   - **MERGE (Add/Update)**: When user says "make it", "also", "add", "with", "and", "X also works", "X too"
   - **REPLACE (Override)**: When user says "instead", "change to", "switch to", "replace with", "prefer X instead"
   - **REMOVE (Set to null)**: When user says "any", "doesn't matter", "remove", "no preference", "no X"
   - **EXCLUDE (Negative intent)**: When user says "not", "avoid", "no", "without", "don't want", "exclude"

3. **Enhanced Examples**:
   - Added examples for less common constraint types (rises, fits, sleeveLengths, necklines, styles, patterns, formalityLevel, seasons, inclusivitySizing, etc.)
   - Added examples for enriched attributes (colorShade, colorUndertone, seasonalPalette, careRequirements, travelFeatures, ecoMaterials, etc.)
   - Added examples for category-specific constraints (scents, rooms, useCases, benefits, claims, etc.)

4. **Updated Rules Section**:
   - Rule #8: Now explicitly states it applies to **ALL array constraints** (not just colors, sizes, patterns)
   - Rule #9: New rule for **ALL single-value constraints**
   - Rule #10: New rule for **ALL boolean constraints**

### Constraint Types Covered

The prompt now explicitly covers operations for:
- **Core constraints**: colors, materials, patterns, styles, lengths, sleeveLengths, necklines, fits, rises, occasions, seasons, formalityLevel, sizes, ageGroups, collections, embellishments, priceMinCents, priceMaxCents
- **Enriched attributes**: colorShade, colorUndertone, multicolor, seasonalPalette, inclusivitySizing, setVsSingle, careRequirements, rainWind, travelFeatures, pockets, liningType, braSolution, ecoMaterials, certifications, origin, adaptiveFeatures, sensoryFriendly, finish, modestyCues, layeringIntent, pairingIntent, temperatureIntent, humidityFriendly, occasionContext, problemSolutions, functionFeatures
- **Category-specific**: scents (perfumes/candles), rooms (home & living), useCases, benefits, claims, sensoryProfile, compatibility

### Impact

This enhancement ensures that:
1. The LLM understands that add/remove/replace/exclude operations work for **ALL constraint types**
2. Follow-up queries can modify **any constraint type**, not just the common ones
3. The system can handle refinements for less common constraints (e.g., "change to high rise", "also plus size", "not organic", "any scent is fine")

## Testing Recommendations

Test the following scenarios to verify the enhancement:
1. **Add operations**: "also high rise", "also plus size", "also organic", "also with pockets"
2. **Replace operations**: "high rise instead", "petite instead", "cotton instead", "without pockets"
3. **Remove operations**: "any rise is fine", "any size", "any material", "pockets don't matter"
4. **Exclude operations**: "not high rise", "not plus size", "not organic", "without pockets"
