# Shopping Assistant Pipeline - Complete Overview

## 🎯 What This Document Explains

This document explains how our shopping assistant works from the moment a customer types a query until they see product recommendations. It's written in plain language for non-technical readers.

---

## 📋 Key Concepts First

### **Classification**
Classification is like understanding what the customer really wants. When someone says "I need something for a beach wedding," the system figures out:
- What type of product they're looking for (dress, bikini, accessories)
- What style they want (elegant, casual, romantic)
- What constraints matter (color, price, size, occasion)

Think of it as translating natural language into a structured shopping request.

### **Constraints**
Constraints are the specific requirements extracted from the customer's query. Examples:
- **Colors**: "blue", "white", "light colors"
- **Price**: "under $200", "between $50-$100"
- **Occasions**: "beach wedding", "office", "casual"
- **Sizes**: "small", "medium", "large"
- **Styles**: "elegant", "romantic", "minimalist"
- **Materials**: "cotton", "silk", "linen"

### **Hard Filters**
Hard filters are requirements that **must** be met - products that don't match are completely excluded. Examples:
- **Stock status**: Only show in-stock products (by default)
- **Gender**: If someone asks for "women's dresses", exclude men's items
- **Category**: If someone asks for "dresses", exclude tops, bottoms, etc.
- **Price range**: If someone says "under $100", exclude anything over $100

Hard filters are applied at the database level for efficiency - they narrow down the catalog before any other processing happens.

### **Soft Constraints**
Soft constraints are preferences that influence ranking but don't exclude products. For example:
- If someone says "I prefer blue but open to other colors," blue items rank higher but other colors still show
- If someone says "elegant style," elegant items rank higher but other styles can appear

---

## 🔄 The Complete Pipeline: Step-by-Step

### **Step 1: Safety Check**
**What happens**: The system checks if the query is appropriate and shopping-related.

**Customer Journey Examples**:
- ✅ "Show me dresses" → Passes safety check
- ✅ "I need something for a wedding" → Passes safety check
- ❌ "What's the weather today?" → Blocked (not shopping-related)
- ❌ Crisis/self-harm queries → Handled with compassionate response

**Outcome**: If the query is safe and shopping-related, proceed. Otherwise, return a helpful message.

---

### **Step 2: Product Context Questions (PDP Suitability)**
**What happens**: If the customer is asking about a specific product they've selected (e.g., "Is this good for a beach wedding?"), the system answers directly without searching.

**Customer Journey Example**:
- Customer clicks on a dress and asks: "Will this work for a formal event?"
- System loads that specific product and generates an answer about its suitability
- No product search happens - just a direct answer

**Outcome**: If it's a product-specific question, return an answer and skip the rest of the pipeline.

---

### **Step 3: Follow-Up Detection**
**What happens**: The system checks if this is a follow-up to a previous query (e.g., "make it cheaper" after "show me dresses").

**Customer Journey Examples**:
- **New Query**: "Show me blue dresses" → Treated as new search
- **Follow-Up**: "Make them cheaper" (after "show me blue dresses") → Merged with previous query
- **Follow-Up**: "Only in light colors" (after "show me dresses") → Merged with previous query

**How it works**:
1. System checks if there's a previous query in the conversation
2. If the new message is short and seems related, it's treated as a follow-up
3. The system intelligently merges constraints:
   - "Make it cheaper" → Lowers the price constraint
   - "Only in light colors" → Adds color constraint, keeps everything else
   - "Show me floral ones" → Adds pattern constraint, keeps previous constraints

**Outcome**: 
- If it's a follow-up, constraints are merged and the enhanced query continues through the pipeline
- If it's a new query, proceed with fresh classification

---

### **Step 4: Query Categorization**
**What happens**: The system determines if the query is:
- **Direct Search**: Clear product request (e.g., "blue dresses under $100")
- **Indirect Search**: Vague or exploratory (e.g., "something for a wedding")
- **Irrelevant**: Not shopping-related

**Customer Journey Examples**:
- **Direct Search**: "Show me floral maxi dresses" → Proceeds to classification
- **Indirect Search**: "I need something for a beach wedding" → May ask clarifying questions OR proceed if category can be identified
- **Irrelevant**: "What's your return policy?" → Returns helpful message

**Special Handling for Indirect Searches**:
- System tries to identify product categories first (dresses, tops, accessories, etc.)
- If categories can be identified confidently → Proceeds with discovery
- If unclear → Asks 2-3 clarifying questions to understand what the customer wants

**Outcome**: Query is categorized and either proceeds to classification or asks clarifying questions.

---

### **Step 5: Query Classification**
**What happens**: The system uses AI to extract all constraints from the query and classify the intent.

**What Gets Extracted**:
- **Product Type**: Dresses, tops, bottoms, accessories, etc.
- **Colors**: Blue, white, light colors, etc.
- **Price Range**: Under $100, between $50-$200, etc.
- **Occasions**: Beach wedding, office, casual, formal, etc.
- **Styles**: Elegant, romantic, minimalist, etc.
- **Materials**: Cotton, silk, linen, etc.
- **Patterns**: Floral, striped, solid, etc.
- **Sizes**: Small, medium, large, etc.
- **Fits**: Relaxed, fitted, loose, etc.
- **Age Groups**: Kids, adults, etc.

**Customer Journey Examples**:
- "Show me blue floral dresses for a beach wedding under $200" →
  - Colors: ["Blue"]
  - Patterns: ["Floral"]
  - Category: ["Dresses"]
  - Occasions: ["Beach Wedding"]
  - Price Max: $200

- "I need elegant tops in light colors" →
  - Styles: ["Elegant"]
  - Category: ["Tops"]
  - Colors: ["Light colors"] (expanded to white, cream, ivory, blush, etc.)

**Outcome**: A structured set of constraints that represent what the customer wants.

---

### **Step 6: Category Classification (Parallel)**
**What happens**: The system identifies the top 3 product categories (e.g., "Dresses", "Tops", "Accessories") for hard filtering.

**Why it matters**: This creates a hard filter at the database level - if someone asks for "dresses", the system only searches the dresses category, making searches faster and more accurate.

**Customer Journey Examples**:
- "Show me dresses" → Categories: ["Dresses"]
- "I need something for a wedding" → Categories: ["Dresses", "Tops", "Accessories"] (if unclear, searches all)
- "Show me kids' clothes" → Categories: ["Kids Apparel"]

**Outcome**: Top categories identified for hard SQL-level filtering (applied before retrieval).

---

### **Step 7: Query Parsing**
**What happens**: The system separates product terms (what they're looking for) from constraints (requirements).

**Why it matters**: 
- Product terms are used for better semantic search (e.g., "dresses" vs "I need dresses for a wedding")
- Constraints are used for ranking (e.g., price, color, style)

**Customer Journey Example**:
- Query: "Show me blue floral dresses under $200"
- Product Terms: "dresses" (used for vector search)
- Constraints: { colors: ["Blue"], patterns: ["Floral"], priceMaxCents: 20000 }

**Outcome**: Clean product terms for search and parsed constraints for ranking.

---

### **Step 8: Multi-View Retrieval**
**What happens**: The system searches the product catalog using multiple methods in parallel:

1. **Semantic Search (Vector)**: Finds products similar in meaning to the query
   - Uses product terms (e.g., "dresses") to find semantically similar products
   - Example: "maxi dresses" finds "long dresses", "floor-length dresses", etc.

2. **Lexical Search (Keyword)**: Finds products matching specific keywords
   - Currently disabled (vector search is better)

3. **Concept Search (Structured Attributes)**: Searches structured product attributes
   - Currently disabled for this dataset

**Hard Filters Applied**:
- **Category Filter**: Only searches in the identified categories (e.g., only "Dresses")
- **Stock Status**: Only in-stock products (by default)
- **Gender**: Only matching gender (if specified)
- **Price Range**: Only products within price range (if specified)

**Customer Journey Example**:
- Query: "Show me blue floral dresses under $200"
- Hard Filters Applied:
  - Category: Only "Dresses"
  - Stock: Only "in_stock"
  - Price: Only products ≤ $200
- Semantic Search: Finds dresses similar to "blue floral dresses"
- Results: 40-100 candidate products (already filtered by hard constraints)

**Outcome**: A list of candidate product IDs ranked by relevance, with scores for each.

---

### **Step 9: Product Loading**
**What happens**: The system loads full product details for the top candidates (typically 40 products).

**What Gets Loaded**:
- Product title, description, images
- Price, sale price, currency
- Category, stock status
- All attributes (colors, materials, styles, occasions, etc.)

**Outcome**: Full product data ready for filtering and ranking.

---

### **Step 10: Attribute Filtering (In-Memory)**
**What happens**: The system applies hard attribute filters that couldn't be applied at the database level (because they're stored in JSON).

**Hard Attribute Filters**:
- **Colors**: Product must match requested colors (e.g., "Blue" matches "Navy Blue", "Sky Blue")
- **Materials**: Product must contain requested materials (e.g., "Cotton" matches "75% Cotton 21% Polyester")
- **Occasions**: Product must match requested occasions (e.g., "Beach Wedding")
- **Sizes**: Product must be available in requested sizes
- **Patterns**: Product must match requested patterns (e.g., "Floral")

**Customer Journey Example**:
- Query: "Show me blue floral dresses"
- After retrieval: 50 candidate products
- After color filter: 30 products (20 excluded - not blue)
- After pattern filter: 15 products (15 excluded - not floral)

**Outcome**: Products that match all hard attribute constraints.

---

### **Step 11: Constraint Relaxation (If Needed)**
**What happens**: If hard filters eliminate all products, the system relaxes constraints in tiers:

**Relaxation Tiers** (in order):
1. **Drop Category**: Remove category filter, keep price/brand/stock/gender
2. **Drop Brand**: Remove brand filter, keep price/stock/gender
3. **Drop Price**: Remove price filter, keep stock/gender
4. **Stock Only**: Only keep stock filter (and gender if specified)

**Customer Journey Example**:
- Query: "Show me blue floral dresses under $50"
- After filters: 0 products (too restrictive)
- Relaxation Tier 1: Drop category → Still 0 products
- Relaxation Tier 2: Drop brand → Still 0 products
- Relaxation Tier 3: Drop price → 10 products found
- Result: Shows 10 products (blue floral dresses, but some over $50)

**Outcome**: Products that match relaxed constraints, with a flag indicating relaxation occurred.

---

### **Step 12: Constraint-Based Ranking**
**What happens**: The system ranks products by how well they match the customer's constraints, combining:
- **Vector Similarity Score**: How semantically similar the product is to the query
- **Constraint Match Score**: How well the product matches constraints (colors, styles, occasions, etc.)

**Scoring**:
- Products that match more constraints rank higher
- Products that match explicitly mentioned constraints (e.g., "blue" when customer said "blue") rank higher
- Vector similarity ensures products are still relevant to the query

**Customer Journey Example**:
- Query: "Show me blue floral dresses for a beach wedding"
- Product A: Blue floral dress, beach-appropriate → High score (matches all constraints)
- Product B: Blue dress, not floral → Lower score (missing pattern)
- Product C: Floral dress, not blue → Lower score (missing color)
- Product D: Blue floral dress, formal → Lower score (wrong occasion)

**Outcome**: Products ranked by relevance, with scores indicating match quality.

---

### **Step 13: Diversity Adjustment**
**What happens**: The system applies a small penalty to products recently shown to the customer, encouraging new products to surface.

**Why it matters**: Prevents showing the same products repeatedly, giving customers variety.

**Outcome**: Final ranked list with diversity adjustments.

---

### **Step 14: Confidence Check**
**What happens**: The system checks if the top products are relevant enough to show.

**Checks**:
- **Relevance Score**: Top product must have a minimum relevance score (≥ 0.2)
- **Product Type Match**: If customer asked for "dresses", top product should be a dress
- **Confidence Threshold**: For follow-ups, top product must meet a confidence threshold (≥ 0.25)

**Customer Journey Examples**:
- ✅ Top product: Blue floral dress, score 0.6 → Shows products
- ❌ Top product: Cardigan (when customer asked for "joggers"), score 0.3 → Shows regretful message
- ❌ Top product: Blue dress, score 0.15 → Shows regretful message (too low relevance)

**Outcome**: Either proceed to show products or return a regretful message asking for clarification.

---

### **Step 15: Reply Generation (Parallel)**
**What happens**: The system generates a conversational reply explaining the results.

**What Gets Generated**:
- **Reply Text**: A friendly, witty message explaining what was found
- **Product Reasons**: For each product, a "Chosen because..." explanation

**Customer Journey Example**:
- Query: "Show me blue floral dresses for a beach wedding"
- Reply: "I found some beautiful blue floral dresses perfect for a beach wedding! These pieces capture that romantic, effortless vibe you're looking for."
- Product Reason: "Chosen because: This blue floral maxi dress is perfect for beach weddings with its lightweight fabric and elegant design."

**Outcome**: Conversational reply ready to show the customer.

---

### **Step 16: Product Card Building (Parallel)**
**What happens**: The system builds product cards with:
- Product image, title, price
- Key attributes (top 5: style, length, occasion, pattern, material, color)
- "Chosen because..." reason
- "View product" button

**Outcome**: Product cards ready to display.

---

### **Step 17: Dialogue Routing (Parallel)**
**What happens**: The system determines the conversation route for analytics:
- **DISCOVERY**: New product search
- **REFINE**: Follow-up refinement
- **CLARIFICATION_NEEDED**: Asked clarifying questions
- **NO_MATCH**: No relevant products found

**Outcome**: Route identifier for analytics.

---

### **Step 18: Final Response Assembly**
**What happens**: The system combines:
- Reply text
- Product cards (top 4 products)
- Actions (e.g., "Show more" if more products available)
- Resolved constraints (for frontend state)

**Outcome**: Complete response ready to send to the customer.

---

## 🛤️ Complete Customer Journeys

### **Journey 1: Direct Product Search**
1. Customer: "Show me blue floral dresses under $200"
2. **Safety Check** → Passes
3. **Follow-Up Detection** → New query
4. **Query Categorization** → Direct search
5. **Query Classification** → Extracts: colors=["Blue"], patterns=["Floral"], category=["Dresses"], priceMax=200
6. **Category Classification** → Categories: ["Dresses"]
7. **Query Parsing** → Product terms: "dresses", Constraints: {colors, patterns, priceMax}
8. **Multi-View Retrieval** → Hard filters: category="Dresses", stock="in_stock", price≤$200 → Finds 50 candidates
9. **Product Loading** → Loads top 40 candidates
10. **Attribute Filtering** → Filters by color="Blue", pattern="Floral" → 15 products remain
11. **Constraint-Based Ranking** → Ranks by vector similarity + constraint matches
12. **Confidence Check** → Top product score 0.6 → Proceeds
13. **Reply Generation** → "I found some beautiful blue floral dresses..."
14. **Product Cards** → Shows top 4 products
15. **Response** → Customer sees reply + 4 product cards

---

### **Journey 2: Follow-Up Refinement**
1. Customer: "Show me blue dresses" → Gets results
2. Customer: "Make them cheaper"
3. **Safety Check** → Passes
4. **Follow-Up Detection** → Detected as follow-up
5. **Constraint Merging** → Merges: colors=["Blue"] (kept), priceMax=lowered (new)
6. **Query Classification** → Uses merged constraints
7. **Multi-View Retrieval** → Hard filters: category="Dresses", stock="in_stock", price≤new_max → Finds 30 candidates
8. **Attribute Filtering** → Filters by color="Blue" → 12 products remain
9. **Constraint-Based Ranking** → Ranks by vector similarity + constraint matches
10. **Confidence Check** → Top product score 0.5 → Proceeds
11. **Reply Generation** → "Here are some more affordable blue dresses..."
12. **Product Cards** → Shows top 4 products (different from before)
13. **Response** → Customer sees reply + 4 product cards

---

### **Journey 3: Vague Query with Clarification**
1. Customer: "I need something for a beach wedding"
2. **Safety Check** → Passes
3. **Follow-Up Detection** → New query
4. **Query Categorization** → Indirect search (vague)
5. **Category Classification** → Tries to identify categories → Low confidence
6. **Follow-Up Questions** → Generates 2-3 questions
7. **Response** → "I'd love to help you find something perfect for a beach wedding! Are you looking for:
   - A dress, top, or accessories?
   - What's your preferred style - elegant, casual, or romantic?
   - What's your budget range?"
8. Customer: "A dress, elegant style, under $300"
9. **Follow-Up Detection** → Detected as follow-up (responding to questions)
10. **Query Enhancement** → Enhances query with responses
11. **Query Classification** → Extracts: category=["Dresses"], styles=["Elegant"], occasions=["Beach Wedding"], priceMax=300
12. **Multi-View Retrieval** → Finds candidates
13. **Ranking** → Ranks products
14. **Response** → Customer sees reply + product cards

---

### **Journey 4: Product-Specific Question (PDP)**
1. Customer clicks on a dress and asks: "Will this work for a formal event?"
2. **Safety Check** → Passes
3. **Product Context Detection** → Detected (productContextId present)
4. **Product Loading** → Loads the specific product
5. **LLM Analysis** → Analyzes product attributes and answers the question
6. **Response** → "Yes! This dress would work beautifully for a formal event. It features an elegant silhouette and sophisticated design that's perfect for formal occasions."
7. **No Product Search** → Skips the rest of the pipeline

---

### **Journey 5: No Results Found**
1. Customer: "Show me red silk ballgowns under $50"
2. **Safety Check** → Passes
3. **Query Classification** → Extracts: colors=["Red"], materials=["Silk"], category=["Dresses"], priceMax=50
4. **Multi-View Retrieval** → Hard filters applied → 0 candidates (too restrictive)
5. **Constraint Relaxation** → Tier 1: Drop category → Still 0
6. **Constraint Relaxation** → Tier 2: Drop brand → Still 0
7. **Constraint Relaxation** → Tier 3: Drop price → 5 candidates found
8. **Attribute Filtering** → Filters by color="Red", material="Silk" → 2 products remain
9. **Ranking** → Ranks products
10. **Confidence Check** → Top product score 0.18 → Too low
11. **Regretful Reply** → "I couldn't find any red silk ballgowns under $50. Would you like to see similar options in a different price range or style?"
12. **Response** → Customer sees regretful message, no products shown

---

## 📊 Summary: The Complete Flow

```
Customer Query
    ↓
Safety Check → Block if unsafe/irrelevant
    ↓
Product Context? → Answer directly if product-specific question
    ↓
Follow-Up? → Merge constraints if follow-up detected
    ↓
Query Categorization → Direct/Indirect/Irrelevant
    ↓
Query Classification → Extract constraints (colors, price, styles, etc.)
    ↓
Category Classification → Identify top categories for hard filtering
    ↓
Query Parsing → Separate product terms from constraints
    ↓
Multi-View Retrieval → Search with hard filters (category, stock, price, gender)
    ↓
Product Loading → Load top 40 candidates
    ↓
Attribute Filtering → Apply hard attribute filters (colors, materials, etc.)
    ↓
Constraint Relaxation → Relax if no results (drop category → drop brand → drop price)
    ↓
Constraint-Based Ranking → Rank by vector similarity + constraint matches
    ↓
Diversity Adjustment → Penalize recently shown products
    ↓
Confidence Check → Verify top products are relevant
    ↓
Reply Generation + Product Cards + Dialogue Routing (Parallel)
    ↓
Final Response → Reply text + Product cards + Actions
```

---

## 🔑 Key Takeaways

1. **Hard Filters** are applied early (database level) for efficiency - they exclude products that don't match
2. **Constraints** are extracted from natural language and used for both filtering and ranking
3. **Classification** understands intent and extracts all requirements from the query
4. **Follow-Ups** are intelligently merged with previous queries to build context
5. **Relaxation** ensures customers always see results, even if constraints are too restrictive
6. **Ranking** combines semantic similarity with constraint matching for best results
7. **Confidence Checks** ensure only relevant products are shown

---

## 💡 How This Helps Customers

- **Natural Language**: Customers can ask in their own words, not using filters
- **Context Awareness**: Follow-ups are understood in context (e.g., "make it cheaper" after "show me dresses")
- **Always Results**: Even if constraints are too restrictive, the system relaxes them to show something
- **Relevant Results**: Hard filters and ranking ensure only relevant products are shown
- **Conversational**: Replies are friendly and explain why products were chosen

---

*This document provides a complete, non-technical overview of the shopping assistant pipeline.*

---

## 🎯 Attribute Weighting System

### How Attribute Weights Are Assigned

The system uses a **hybrid approach**: **base weights** (static hierarchy) + **dynamic adjustments** (query-specific).

#### **Base Weights (Static Hierarchy)**

Every attribute has a base weight that reflects its general importance. This creates a default hierarchy:

| Attribute | Base Weight | Priority Level |
|-----------|------------|----------------|
| **Age Groups** | 1.5 | Highest (critical for kids vs adults) |
| **Colors** | 1.0 | Very High |
| **Sizes** | 0.8 | High |
| **Occasions** | 0.6 | Medium-High |
| **Styles** | 0.4 | Medium |
| **Patterns** | 0.4 | Medium |
| **Lengths** | 0.4 | Medium |
| **Seasons** | 0.3 | Medium-Low |
| **Necklines** | 0.3 | Medium-Low |
| **Sleeve Lengths** | 0.3 | Medium-Low |
| **Price** | 0.3 | Medium-Low |
| **Materials** | 0.2 | Low |
| **Fits** | 0.2 | Low |
| **Collections** | 0.2 | Low |

**Why this hierarchy?**
- **Age Groups** (1.5): Critical - showing kids' products to adults (or vice versa) is a major error
- **Colors** (1.0): Very important - customers often have strong color preferences
- **Sizes** (0.8): Important - availability in requested size matters
- **Occasions** (0.6): Important - "beach wedding" vs "office" are very different needs
- **Materials** (0.2): Lower - nice to have, but less critical than color/style

#### **Dynamic Weight Adjustments**

Base weights are adjusted based on **query context**:

1. **Explicit Mentions**: If an attribute is explicitly mentioned in the query, its weight increases
2. **Query Type**: Different query types adjust weights (e.g., occasion-based queries boost occasions)
3. **Context Inference**: Some attributes get boosted based on context clues

**Examples of Dynamic Adjustments**:

| Attribute | Base Weight | Explicitly Mentioned | Query Type Adjustment | Context Inference |
|-----------|------------|---------------------|----------------------|-------------------|
| **Occasions** | 0.6 | → **1.2** ("for wedding") | → **1.0** (occasion_based query) | → **0.8** (inferred) |
| **Materials** | 0.2 | → **0.8** ("silk dress") | → **0.4** (style_exploration) | → 0.2 (base) |
| **Seasons** | 0.3 | → **0.7** ("summer dress") | → 0.3 (base) | → **0.5** ("miami", "beach") |
| **Lengths** | 0.4 | → **0.8** ("mini dress") | → 0.4 (base) | → 0.4 (base) |
| **Fits** | 0.2 | → **0.6** ("relaxed fit") | → 0.2 (base) | → 0.2 (base) |
| **Necklines** | 0.3 | → **0.6** ("v-neck") | → 0.3 (base) | → 0.3 (base) |

#### **How It Works in Practice**

**Example 1: Explicit Mention**
- Query: "Show me silk dresses"
- Materials weight: **0.2** (base) → **0.8** (explicitly mentioned)
- Result: Products with silk material rank much higher

**Example 2: Query Type Adjustment**
- Query: "I need something for a beach wedding"
- Query Type: `occasion_based`
- Occasions weight: **0.6** (base) → **1.0** (occasion_based query)
- Result: Products matching "beach wedding" occasion rank higher

**Example 3: Context Inference**
- Query: "Show me dresses for Miami"
- Seasons weight: **0.3** (base) → **0.5** (inferred from "Miami" = summer/tropical)
- Result: Summer-appropriate dresses rank slightly higher

**Example 4: Multiple Adjustments**
- Query: "Show me silk dresses for a wedding"
- Materials weight: **0.2** → **0.8** (explicitly mentioned: "silk")
- Occasions weight: **0.6** → **1.2** (explicitly mentioned: "for a wedding")
- Result: Products matching both silk material AND wedding occasion rank highest

#### **Final Score Calculation**

For each product, the system:
1. Calculates a match score (0-1) for each constraint
2. Multiplies each match score by its dynamic weight
3. Sums all weighted scores
4. Divides by the number of constraints (weighted average)

**Formula**:
```
Final Score = (Sum of all weighted constraint scores) / (Number of constraints)
```

**Example**:
- Product matches: Colors (score: 1.0, weight: 1.0), Occasions (score: 0.8, weight: 1.2), Materials (score: 0.5, weight: 0.8)
- Weighted scores: (1.0 × 1.0) + (0.8 × 1.2) + (0.5 × 0.8) = 1.0 + 0.96 + 0.4 = 2.36
- Final Score: 2.36 / 3 = **0.787**

#### **Combined with Vector Similarity**

The constraint match score is combined with vector similarity:
```
Final Ranking Score = Vector Similarity + (Constraint Score × Dynamic Boost)
```

**Dynamic Boost**:
- If average constraint score > 0.3: Boost = **0.8** (constraints matter a lot)
- If average constraint score ≤ 0.3: Boost = **0.4** (constraints matter less)

This ensures:
- Products matching constraints rank higher
- Products with high vector similarity still appear even if they don't match all constraints
- The system adapts based on how well products match constraints overall

---

## 📊 Summary: Weighting System

1. **Base Weights**: Static hierarchy (ageGroups > colors > sizes > occasions > styles > materials)
2. **Dynamic Adjustments**: Boost weights based on:
   - Explicit mentions in query
   - Query type (occasion_based, style_exploration, etc.)
   - Context clues (location keywords, etc.)
3. **Final Scoring**: Weighted average of constraint matches, combined with vector similarity
4. **Adaptive Boost**: Higher boost when constraints match well, lower when they don't

**Key Insight**: The system is **intelligent** - it recognizes when customers explicitly mention something (like "silk" or "for wedding") and gives those attributes more importance, while still maintaining a sensible default hierarchy for inferred constraints.


