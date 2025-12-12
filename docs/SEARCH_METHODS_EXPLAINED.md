# How Lexical, Semantic, and Concept Search Work (Simple Explanation)

## 🎯 The Big Picture

When you search for products, the system uses **three different search methods at the same time** (in parallel) to find the best matches. Think of it like asking three different experts for recommendations, then combining their answers.

---

## 1️⃣ Lexical Search (The Keyword Matcher)

### What it does:
**Lexical search = matching exact words and phrases**

### Simple explanation:
Imagine you're searching a library catalog by typing keywords. If you search for "hand cream", it looks for products that have the words "hand" and "cream" in their title or description.

### How it works:
1. **Takes your query** (e.g., "moisturizing hand cream")
2. **Breaks it into keywords** ("moisturizing", "hand", "cream")
3. **Searches the database** using PostgreSQL full-text search
4. **Ranks results** by:
   - Exact phrase matches (highest score)
   - Word combinations (medium score)
   - Individual word matches (lower score)
   - Category boosts (if merchant rules say to prioritize certain categories)

### Example:
- Query: "hand cream"
- Finds: Products with "hand cream" in title/description
- Ranking: "Hand Cream" (exact match) > "Hand & Body Cream" (partial) > "Cream for Hands" (words present)

### Strengths:
✅ Great for exact product names  
✅ Fast (uses database indexes)  
✅ Finds products when you know what you're looking for

### Weaknesses:
❌ Misses products that use different words but mean the same thing  
❌ "anti-aging" won't find "wrinkle reduction" (different words, same concept)

---

## 2️⃣ Semantic Search (The Meaning Matcher)

### What it does:
**Semantic search = matching meaning and context, not just words**

### Simple explanation:
Instead of matching words, it understands what you *mean*. It's like having a friend who understands your intent even if you use different words.

### How it works:
1. **Converts your query to numbers** (called an "embedding")
   - Uses AI (OpenAI) to turn text into a 1536-dimensional vector
   - Example: "anti-aging cream" → `[0.123, -0.456, 0.789, ...]` (1536 numbers)
2. **Converts all products to numbers** (same process, done ahead of time)
3. **Finds similar vectors** using math (cosine similarity)
   - Products with similar meanings have similar vectors
   - Closer vectors = more similar meaning

### Example:
- Query: "something to reduce wrinkles"
- Embedding: `[0.1, -0.3, 0.7, ...]`
- Finds: Products with embeddings like `[0.12, -0.28, 0.72, ...]`
- Results: "Anti-Aging Face Cream", "Wrinkle Reduction Serum" (even though they don't contain your exact words!)

### Strengths:
✅ Finds products even when words don't match  
✅ Understands synonyms and related concepts  
✅ Great for vague queries like "something for dry skin"

### Weaknesses:
❌ Slower (needs to call AI API to generate embeddings)  
❌ Requires products to have embeddings pre-computed  
❌ Can sometimes be too broad (finds things that are related but not exactly what you want)

---

## 3️⃣ Concept Search (The Attribute Matcher)

### What it does:
**Concept search = matching specific attributes and properties**

### Simple explanation:
This is like using filters on a shopping site. Instead of searching by text, you're searching by specific properties: "I want something with almond oil, for sensitive skin, that's paraben-free."

### How it works:
1. **Builds an index** (like a phone book) that maps:
   - Concerns → Products (e.g., "anti-aging" → [Product A, Product B, Product C])
   - Skin Types → Products (e.g., "sensitive" → [Product D, Product E])
   - Ingredients → Products (e.g., "almond oil" → [Product A, Product F])
   - Application Areas → Products (e.g., "face" → [Product B, Product G])
   - Made Without → Products (e.g., "parabens" → [Product A, Product D])
   - Product Types → Products (e.g., "Hand Cream" → [Product H, Product I])

2. **Searches the index** by looking up your constraints:
   - Query: "anti-aging face cream with almond oil"
   - Looks up "anti-aging" in concerns → finds Product A, B, C
   - Looks up "face" in applicationAreas → finds Product B, G
   - Looks up "almond oil" in ingredients → finds Product A, F
   - Combines all matches (union): Product A, B, C, F, G

3. **Returns products** that match ANY of your constraints (OR logic)

### Example:
- Query: "paraben-free moisturizer for sensitive skin"
- Constraints extracted:
  - `madeWithout: ["parabens"]`
  - `skinTypes: ["sensitive"]`
  - `productTypes: ["moisturizer"]`
- Index lookups:
  - Parabens-free products: [A, B, C]
  - Sensitive skin products: [B, D, E]
  - Moisturizers: [A, B, F]
- Result: Union = [A, B, C, D, E, F]

### Strengths:
✅ Very fast (in-memory lookups, <10ms)  
✅ Precise for attribute-based queries  
✅ Great for filtering by specific requirements

### Weaknesses:
❌ Only works if products have structured attributes  
❌ Requires building and maintaining the index  
❌ Less flexible for natural language queries

---

## 🔄 How They Work Together (Multi-View Retrieval)

All three methods run **in parallel** (at the same time):

```
User Query: "anti-aging face cream with almond oil"
         ↓
    ┌────┴────┐
    │         │         │
    ↓         ↓         ↓
Lexical   Semantic   Concept
Search    Search     Search
    │         │         │
    └────┬────┘         │
         ↓              ↓
    Merge Results    Track Matches
         ↓              ↓
    └────┴─────────────┘
         ↓
    Up to 400 candidate products
         ↓
    Load full product data
         ↓
    Ranking & Scoring
         ↓
    Top 20 products
         ↓
    Final selection (top 4)
```

### Step-by-step:

1. **Parallel Retrieval** (all at once):
   - Lexical: Finds 150 products matching keywords
   - Semantic: Finds 150 products with similar meaning
   - Concept: Finds products matching attributes

2. **Merging**:
   - Combines all product IDs (removes duplicates)
   - Keeps up to 400 unique candidates
   - Tracks scores from each method:
     - Lexical scores: How well keywords matched
     - Semantic scores: How similar the meaning is (0-1)
     - Concept matches: Which attributes matched

3. **Product Loading**:
   - Loads full product data for all candidates
   - Filters for valid products (in stock, active, etc.)

4. **Ranking**:
   - Builds features for each product
   - Scores products using weighted formula
   - Sorts by score (highest first)

5. **Final Selection**:
   - Takes top 20 ranked products
   - Removes duplicates (by product URL)
   - Returns top 4 for display

---

## 📊 How Final Outputs Are Selected

### Ranking Formula

Each product gets a **score** based on multiple factors:

```typescript
score = 
  (lexicalScore × 5.0) +                    // Keyword matching
  (semanticSimilarity × 5.0) +              // Meaning similarity
  (titleMatch × 8.0-12.0) +                 // Exact title match
  (concernsOverlap × 10.0-15.0) +           // Concern matching
  (skinTypeMatch × 8.0-12.0) +              // Skin type match
  (ingredientMatchCount × 8.0-15.0) +        // Ingredient matches
  (productTypeMatch × 6.0-10.0) +           // Product type match
  (popularityScore × 3.0-8.0) +             // Popularity boost
  (inventoryStatus × 5.0) -                  // In-stock preference
  (priceDistance × 5.0)                      // Budget penalty
```

### Weights Change Based on Query Type

**Symptom/Concern Queries** (e.g., "dry skin"):
- High weight on: concerns (15.0), skin types (12.0), application areas (10.0)
- Lower weight on: ingredients (4.0)

**Ingredient Queries** (e.g., "products with almond oil"):
- High weight on: ingredients (15.0)
- Lower weight on: concerns (5.0)

**Direct Product Search** (e.g., "hand cream"):
- High weight on: title match (12.0), product type (10.0), lexical (8.0)
- Lower weight on: concerns (5.0)

**Vague/Gift Queries** (e.g., "gift for mom"):
- High weight on: popularity (8.0), product type (8.0)
- Balanced weights across other features

### Selection Process

1. **Feature Engineering**:
   - For each product, calculates:
     - How many concerns match
     - How many ingredients match
     - Title overlap percentage
     - Price distance from budget
     - Popularity score
     - Inventory status
     - Lexical and semantic scores (from retrieval)

2. **Scoring**:
   - Applies weighted formula (weights depend on query type)
   - Each product gets a final score

3. **Sorting**:
   - Products sorted by score (highest first)
   - Tie-breaker: Remove duplicates by product URL

4. **Final Output**:
   - Top 20 products from ranking
   - Deduplicated
   - Top 4 selected for display in chat

### Example Selection

**Query**: "anti-aging face cream with almond oil"

**Candidates** (after merging):
- Product A: Anti-Aging Face Cream (almond oil, anti-aging concern)
- Product B: Rejuvenating Face Serum (almond oil, anti-aging concern)
- Product C: Hand Cream (almond oil, but wrong product type)
- Product D: Face Moisturizer (anti-aging, but no almond oil)

**Scoring** (simplified):
- Product A: 
  - Title match: 1.0 × 12.0 = 12.0
  - Concerns: 1.0 × 15.0 = 15.0
  - Ingredients: 1.0 × 15.0 = 15.0
  - Product type: 1.0 × 10.0 = 10.0
  - **Total: 52.0**

- Product B:
  - Title match: 0.5 × 12.0 = 6.0
  - Concerns: 1.0 × 15.0 = 15.0
  - Ingredients: 1.0 × 15.0 = 15.0
  - Product type: 0.8 × 10.0 = 8.0
  - **Total: 44.0**

- Product C:
  - Title match: 0.0 × 12.0 = 0.0
  - Concerns: 0.0 × 15.0 = 0.0
  - Ingredients: 1.0 × 15.0 = 15.0
  - Product type: 0.0 × 10.0 = 0.0 (wrong type)
  - **Total: 15.0**

- Product D:
  - Title match: 0.3 × 12.0 = 3.6
  - Concerns: 1.0 × 15.0 = 15.0
  - Ingredients: 0.0 × 15.0 = 0.0 (no almond oil)
  - Product type: 0.9 × 10.0 = 9.0
  - **Total: 27.6**

**Final Selection**: Product A, Product B, Product D, Product C (in that order)

---

## 🎓 Summary: The Three Methods

| Method | What It Matches | Best For | Speed |
|--------|----------------|----------|-------|
| **Lexical** | Exact words/phrases | Known product names, specific terms | Fast (2-15s) |
| **Semantic** | Meaning and context | Vague queries, synonyms, related concepts | Medium (700ms-2.5s) |
| **Concept** | Attributes and properties | Filtering by ingredients, concerns, skin types | Very Fast (<10ms) |

**Together**, they ensure that no matter how you phrase your query, the system finds relevant products by:
- Matching your exact words (lexical)
- Understanding what you mean (semantic)
- Filtering by specific requirements (concept)

Then, a smart ranking system combines all the signals to pick the best 4 products to show you.

