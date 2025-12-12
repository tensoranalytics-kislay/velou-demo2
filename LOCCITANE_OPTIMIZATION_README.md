# L'Occitane Optimized Pipeline

This document describes the optimized pipeline specifically designed for L'Occitane's beauty/skincare catalog.

## 🚀 Performance Improvements

**Before (Original Pipeline):**
- 4-5 LLM calls per query
- Sequential execution
- Generic prompts for any vertical
- **Latency: 2.7-4.9 seconds**

**After (Optimized Pipeline):**
- 1 LLM call per query
- Parallel search + LLM execution
- L'Occitane-specific prompts and ontology
- **Latency: 1.5-3 seconds** (target: < 5 seconds ✅)

## 📊 Key Optimizations

### 1. Pre-Computed Ontology
- Static knowledge base of L'Occitane collections, product types, concerns, ingredients
- Eliminates dynamic DB queries for ontology building
- **Location:** `src/lib/loccitane/ontology.ts`

### 2. Rule-Based Intent Extraction
- Deterministic follow-up detection (no LLM call)
- Fast keyword matching against L'Occitane taxonomy
- **Location:** `src/lib/loccitane/intent.ts`

### 3. Single-Shot LLM Prompt
- Combines intent extraction AND reply generation in ONE call
- L'Occitane-specific prompt (much smaller than generic prompts)
- **Location:** `src/lib/loccitane/prompts.ts`

### 4. Template-Based Product Reasons
- Rule-based "Chosen because..." reasons (no LLM per product)
- Uses product attributes + templates
- **Location:** `src/lib/loccitane/reasons.ts`

### 5. Parallel Execution
- Search runs in parallel with LLM reply generation
- Reduces total latency by max(search_time, llm_time) instead of sum
- **Location:** `src/lib/loccitane/orchestrator.ts`

## 🔧 How to Enable

Add to your `.env` file:

```bash
# Enable optimized L'Occitane pipeline
USE_LOCCITANE_OPTIMIZED_PIPELINE=true

# Enable raw SQL search for faster queries
ENABLE_RAW_RANKED_SEARCH=true
```

## 📁 Files Created

- `src/lib/loccitane/ontology.ts` - Pre-computed L'Occitane knowledge
- `src/lib/loccitane/intent.ts` - Rule-based intent extraction
- `src/lib/loccitane/prompts.ts` - Single-shot LLM prompt
- `src/lib/loccitane/reasons.ts` - Template-based product reasons
- `src/lib/loccitane/orchestrator.ts` - Fast query orchestrator
- `src/lib/loccitane/index.ts` - Module exports

## 🔄 Pipeline Flow

### Optimized Flow:
```
User Message
    ↓
[Parallel Execution]
    ├─→ Rule-Based Intent (0ms)
    │       ↓
    ├─→ Search Products (200-500ms)
    │       ↓
    └─→ Single LLM Call (800-1500ms)
            ↓
    Merge Results + Template Reasons (50ms)
            ↓
    Response (Total: 1.5-3s)
```

### Original Flow (for comparison):
```
User Message
    ↓
ContextGatekeeper LLM (400-800ms)
    ↓
IntentExtraction LLM (600-1200ms)
    ↓
Search Products (200ms)
    ↓
CardReasons LLM (800-1500ms)
    ↓
FinalReply LLM (600-1000ms)
    ↓
Response (Total: 2.7-4.9s)
```

## 🎯 When to Use

The optimized pipeline is used automatically when:
- `USE_LOCCITANE_OPTIMIZED_PIPELINE=true`
- Query is NOT a PDP page (`pageType !== 'PDP'`)
- Query does NOT have `productContextId` (product Q&A uses original pipeline)

For PDP product Q&A, the original pipeline is still used (it's optimized for that use case).

## 📝 Customization

### Adding New Collections
Edit `src/lib/loccitane/ontology.ts`:
```typescript
export const LOCCITANE_ONTOLOGY = {
  collections: [
    'Shea',
    'Almond',
    'Your New Collection', // Add here
    // ...
  ],
};
```

### Adding New Product Types
Same file:
```typescript
productTypes: [
  'Hand Cream',
  'Your New Product Type', // Add here
  // ...
],
```

### Customizing Product Reasons
Edit `src/lib/loccitane/reasons.ts` to add new templates or logic.

## ⚠️ Important Notes

1. **PostgreSQL Full-Text Search**: For best performance, ensure `search_vector` column is populated:
   ```sql
   UPDATE "Product" SET search_vector = to_tsvector('english', title || ' ' || description);
   CREATE INDEX IF NOT EXISTS idx_product_search ON "Product" USING GIN(search_vector);
   ```

2. **Merchant Detection**: Currently uses default merchant. Future enhancement: detect merchant from catalog data.

3. **Feature Flag**: The original pipeline remains available if you need to fall back. Just set `USE_LOCCITANE_OPTIMIZED_PIPELINE=false`.

## 🐛 Troubleshooting

### Pipeline not activating?
- Check `.env` file has `USE_LOCCITANE_OPTIMIZED_PIPELINE=true`
- Restart your dev server after changing env vars
- Check logs for `pipeline: 'loccitane_optimized'` in API responses

### Slow responses?
- Enable `ENABLE_RAW_RANKED_SEARCH=true` in `.env`
- Ensure PostgreSQL `search_vector` index exists
- Check LLM provider latency (try different models)

### Wrong product types detected?
- Update `PRODUCT_TYPE_SYNONYMS` in `src/lib/loccitane/ontology.ts`
- Add your synonyms to the mapping



