# OR Logic Bonus Explanation

## What does "+0.15 per additional constraint, capped at 0.3" mean?

This bonus rewards products that match **multiple constraints** when OR logic is active.

### How it works:

1. **Base Score**: Product gets the MAX score across all constraints (0-1 range)
   - Example: If product matches formalityLevel (score 0.8) but not occasions (score 0), base score = 0.8

2. **Multi-Match Bonus**: Additional points for matching multiple constraints
   - **1 constraint match**: No bonus (0)
   - **2 constraint matches**: +0.15 bonus
   - **3 constraint matches**: +0.15 + 0.15 = +0.30 bonus
   - **4+ constraint matches**: Still +0.30 bonus (capped at 0.3)

3. **Final Score**: Base score + bonus (capped at 1.0)

### Examples:

**Example 1: Product matches 1 constraint**
- Matches: formalityLevel (score 0.8)
- Doesn't match: occasions (score 0), colors (score 0)
- Base score: 0.8 (MAX of 0.8, 0, 0)
- Bonus: 0 (only 1 constraint matches)
- **Final score: 0.8**

**Example 2: Product matches 2 constraints**
- Matches: formalityLevel (score 0.8), occasions (score 0.9)
- Doesn't match: colors (score 0)
- Base score: 0.9 (MAX of 0.8, 0.9, 0)
- Bonus: +0.15 (2 constraints match)
- **Final score: 1.0** (0.9 + 0.15 = 1.05, capped at 1.0)

**Example 3: Product matches 3 constraints**
- Matches: formalityLevel (score 0.8), occasions (score 0.9), colors (score 0.7)
- Base score: 0.9 (MAX of 0.8, 0.9, 0.7)
- Bonus: +0.30 (3 constraints match, capped at 0.3)
- **Final score: 1.0** (0.9 + 0.30 = 1.2, capped at 1.0)

**Example 4: Product matches 4 constraints**
- Matches: formalityLevel (score 0.8), occasions (score 0.9), colors (score 0.7), materials (score 0.6)
- Base score: 0.9 (MAX of all scores)
- Bonus: +0.30 (4 constraints match, but bonus is capped at 0.3)
- **Final score: 1.0** (0.9 + 0.30 = 1.2, capped at 1.0)

### Why this bonus?

- **Encourages better matches**: Products matching multiple constraints are more relevant
- **Ranking differentiation**: Products matching 2 constraints rank higher than products matching 1 constraint
- **Capped to prevent over-weighting**: Maximum bonus of 0.3 ensures base score still matters

### Implementation:

```typescript
// Count how many constraints have real matches (score > 0.5, not just neutral 0.5)
const realMatchCount = normalizedScores.filter(score => score > 0.5).length;

// Add bonus for matching multiple constraints
const multiMatchBonus = realMatchCount > 1 
  ? Math.min(0.3, (realMatchCount - 1) * 0.15) // +0.15 per additional constraint, capped at 0.3
  : 0;

// Final score: MAX score + bonus
finalScore = Math.min(1.0, maxScore + multiMatchBonus);
```
