# Ranking OR Logic Implementation

## Changes Made

### 1. OR Logic Detection
- Detects when multiple constraint types are present (excluding ageGroups, category, gender)
- Uses OR logic scoring when `constraintTypesCount > 1`

### 2. OR Logic Scoring Strategy
- **MAX Score Approach**: Uses the maximum normalized score across all constraints
  - Products match if ANY constraint matches (OR behavior)
  - Products matching multiple constraints rank higher (bonus added)
  
- **Multi-Match Bonus**: +0.15 per additional matching constraint (capped at 0.3)
  - Products matching 1 constraint: base score
  - Products matching 2 constraints: base score + 0.15
  - Products matching 3+ constraints: base score + 0.3 (max)

- **Minimum Score Guarantee**: Products matching at least one constraint get minimum score of 0.3
  - Ensures products pass threshold (0.25) even if they only match one constraint

### 3. Current Issue
- OR logic is being detected, but only 1 constraint type (colors) is found in ranking
- `occasions` and `formalityLevel` are not in constraints passed to ranking
- This suggests they're being filtered out or are undefined before ranking

### 4. Root Cause
- `occasions` and `formalityLevel` are used as SQL filters (hard filters)
- They may be removed from `constraintsForRanking` to avoid double-filtering
- But we need them in ranking to give credit for matching them!

### 5. Solution Needed
- Ensure `occasions` and `formalityLevel` are included in `constraintsForRanking` even if used as SQL filters
- SQL filters ensure products match (hard filter)
- Ranking gives credit for matching (soft scoring)
- These are complementary, not redundant

## Implementation Details

### OR Logic Scoring Formula
```typescript
if (hasMultipleConstraintTypes) {
  // Normalize each constraint score to 0-1 range
  const normalizedScores = scores.map((weightedScore, idx) => {
    const weight = weights[idx];
    return weight > 0 ? weightedScore / weight : 0;
  });
  
  // MAX score (product matches if ANY constraint matches)
  const maxScore = Math.max(...normalizedScores, 0);
  
  // Count matching constraints
  const matchingConstraintsCount = normalizedScores.filter(score => score > 0).length;
  const realMatchCount = normalizedScores.filter(score => score > 0.5).length;
  
  // Multi-match bonus
  const multiMatchBonus = realMatchCount > 1 
    ? Math.min(0.3, (realMatchCount - 1) * 0.15)
    : 0;
  
  // Final score
  finalScore = Math.min(1.0, maxScore + multiMatchBonus);
  
  // Minimum score guarantee
  if (matchingConstraintsCount >= 1 && finalScore < 0.25) {
    finalScore = 0.3;
  }
}
```

## Next Steps
1. Verify `occasions` and `formalityLevel` are in `constraintsForRanking`
2. Ensure they're passed to ranking even if used as SQL filters
3. Test with office dress query to verify OR logic works correctly
