# Industry-Agnostic Search & Catalog Audit (2025-11-28)

## TL;DR

| Area | Status | Notes |
| --- | --- | --- |
| Unified schema definitions & ingestion | ✅ Pass | CSV schema, normalization, and Prisma upsert all honor the unified vendor fields (identity, classification, experience, extensible). |
| Search constraints & attribute filtering | ⚠️ Pass with caveats | Core filtering is schema-driven, but `buildBroadWhereFilters` and mock data still embed apparel-specific heuristics. |
| Relaxation tiers & logging | ✅ Pass | Recent changes ensure attribute filtering only fires on explicit user facets and logs derived fields for debugging. |
| LLM prompts + orchestrator context | ❌ Fails industry-agnostic goal | Prompt taxonomy, synonyms, and tone are hard-coded to apparel. |
| Sample data, docs, mock generator | ❌ Fails industry-agnostic goal | README scope, mock catalog generator, and help docs all describe/enforce apparel. |

## Schema Consistency

### Definitions mirror the provided CSV header

The unified schema enumerates the exact headers listed in your sample (identity, classification, copy, experience, media, extensible, telemetry). Each field is tagged with type/group metadata so validation can remain data-agnostic.

```34:200:src/lib/catalog/unifiedSchemaConfig.ts
export const UNIFIED_CATALOG_SCHEMA: CatalogFieldDefinition[] = [
  // ===== Identity & Linking =====
  { name: 'product_id', ... },
  ...
  // ===== Classification =====
  { name: 'vertical', ... },
  { name: 'category', ... },
  ...
  { name: 'usage_contexts', ... },
  { name: 'style_tags', ... },
  ...
  // ===== Experience & Efficacy =====
  { name: 'benefits', ... },
  { name: 'claims', ... },
  { name: 'sensory_profile', ... },
  ...
  { name: 'attribute_blob', ... },
];
```

### Normalization + ingestion keep the schema intact

The CSV parser trims strings, converts pipe-delimited lists, and stores everything (including empty arrays) in the normalized row before validation.

```25:170:src/lib/catalog/validation.ts
export function normalizeUnifiedRow(...) { ... usage_contexts: null; style_tags: null; ... }
```

`mapRowToProduct` copies every column from your header into either top-level `Product` fields or the JSON `attributes` blob (useCases, styleTags, benefits, claims, compatibility, attribute_blob, etc.), so downstream search can rely on a consistent shape.

```170:355:src/lib/catalog/ingestUnifiedCsv.ts
if (row.usage_contexts && row.usage_contexts.length > 0) {
  attributes.useCases = row.usage_contexts;
}
...
return {
  create: {
    id: productId,
    title: row.title || row.short_title || 'Untitled Product',
    imageUrl: row.image_url_primary || '',
    productUrl: row.product_url || '',
    ...
    attributes: attributes as Prisma.InputJsonValue,
  },
  update: { ...same fields... },
};
```

### Search layer uses the same schema

`SearchConstraints` and `ProductAttributes` enumerate the same fields, ensuring every ingestion-time attribute is available for filtering or scoring.

```3:80:src/lib/search/types.ts
export type SearchConstraints = {
  query?: string;
  category?: string | string[];
  ...
  useCases?: string[];
  styleTags?: string[];
  benefits?: string[];
  claims?: string[];
  sensoryProfile?: string;
  compatibility?: string[];
  ...
};
export type ProductAttributes = {
  fabric?: string;
  ...
  useCases?: string[];
  styleTags?: string[];
  benefits?: string[];
  claims?: string[];
  sensoryProfile?: string;
  compatibility?: string[];
  ...
};
```

`matchesAttributeFilters` now short-circuits unless explicit user facets were supplied and then checks those facets against the JSON attributes, keeping the logic data-agnostic.

```244:323:src/lib/search/index.ts
export const matchesAttributeFilters = (...) => {
  const metaInfo = meta ?? deriveAttributeConstraintMeta(...);
  if (!metaInfo.hasHardAttributeConstraints) return true;
  ...
  if (constraints.useCases?.length && !arrayIncludes(attrs.useCases, constraints.useCases)) return false;
  if (constraints.customLabels4?.length && !valueMatches(attrs.customLabel4, constraints.customLabels4)) return false;
  ...
  if (constraints.brands?.length && !valueMatches(attrs.brand, constraints.brands)) return false;
  return true;
};
```

## Industry Hardcoding Review

### Catalog ingestion & search

- ✅ **Ingestion** is industry-agnostic: it simply copies whatever the unified CSV provides.
- ⚠️ **Search heuristics** still assume apparel:
  - `buildBroadWhereFilters` rewrites “graphic t shirt” terms and strips “graphic” unless the user explicitly said it.
  - The “canonical category” expansion logic biases toward apparel synonyms.
  - Dynamic take sizing reacts to “apparel keywords”.

```385:415:src/lib/search/index.ts
// CRITICAL FIX: If user message doesn't explicitly mention "graphic" or "printed",
// but LLM output "graphic t shirt", replace it with generic "t shirt" ...
```

```495:513:src/lib/search/index.ts
// Fix D: If category is missing OR query includes apparel keywords, increase take
const isBroadQuery =
  !constraints.category &&
  !constraints.brands?.length &&
  !constraints.priceMinCents &&
  !constraints.priceMaxCents &&
  (!constraints.query || constraints.query.trim().length < 10);
```

- ⚠️ **Mock catalog generator** seeds only apparel SKUs, so end-to-end tests are biased.

```1:120:scripts/generateMockCatalog.ts
console.log('🌱  Seeding mock apparel catalog...');
const CATEGORY_CONFIG = {
  Dresses: { ... },
  Tops: { ... },
  ...
};
```

### LLM prompts & orchestrator

- ❌ **INTENT_AND_CONSTRAINTS_PROMPT** is explicitly tied to a fashion taxonomy (mens/womens/accessories, tshirt synonyms, fabric lists). None of that adapts to beauty, electronics, or home catalog structures.
- ❌ **FINAL_RESPONSE_PROMPT** says “You are a stylist for a premium fashion ecommerce brand,” so even if catalog data changes, the assistant’s tone stays apparel-focused.

```1:126:src/lib/llm/prompts.ts
You are a product-discovery constraint extractor for a fashion catalog.
...
Valid top_level values: ["mens", "womens", "accessories"].
...
NEVER invent a category like "apparel", "tops", "shirts & tops".
...
```

```205:218:src/lib/llm/prompts.ts
export const FINAL_RESPONSE_PROMPT = `You are a stylist for a premium fashion ecommerce brand. ...
```

### Docs, tests, and marketing copy

- ❌ README repeatedly states this is an apparel demo with Lucky Brand data and mock apparel catalog support.

```1:19:README.md
# Velou Shopping Assistant – Demo Prototype (Single Merchant, Apparel)
This repo ... for a single fashion/apparel ecommerce site. ...
```

- ⚠️ Tests reference apparel categories directly (e.g., `tests/search/unifiedAttributes.test.ts` includes “apparel queries”), but that is acceptable if we also add cross-vertical fixtures.

## Recommendations

1. **Parameterize prompts and orchestrator metadata**  
   - Pass dataset taxonomy + vertical into `INTENT_AND_CONSTRAINTS_PROMPT` and the final response prompt so wording can evolve per merchant.  
   - Replace hard-coded category lists with injected ontology data that already exists server-side.

2. **Decouple search heuristics from apparel**  
   - Move the “graphic t-shirt” normalization and apparel keyword heuristics behind optional config derived from catalog metadata (e.g., `datasetContext.primaryCategoryGroup`).  
   - Provide generic fallbacks for other industries (beauty, home, electronics) using the `useCases`/`styleTags` fields we already ingest.

3. **Expand mock data + tests**  
   - Add secondary mock generators (beauty, home) so automated tests run on multiple verticals.  
   - Introduce Vitest fixtures that assert `matchesAttributeFilters` works for skincare-style attributes such as `sensoryProfile`, `benefits`, `compatibility`.

4. **Update documentation**  
   - Keep README’s “single merchant” statement, but clarify the underlying pipeline is industry-agnostic when supplied with the unified schema.  
   - Provide a short “switching verticals” guide that links ingestion, search constraints, and prompt configuration steps.

5. **Surface dataset metadata to the UI**  
   - Admin could upload a CSV sample and we infer vertical + primary facets (already implemented in `datasetInspector`). Use that to toggle prompts, heuristics, and UI text without code edits.

## Appendix: Sample Row Coverage

The sample “Almond Shower Scrub” row you provided includes usage contexts, style tags, ingredients, benefits, compatibility, rich media, and attribute blobs. Every one of those columns is already parsed and stored in `Product.attributes`, so searches on `useCases`, `benefits`, `claims`, `sensoryProfile`, `compatibility`, `media_gallery`, and `attribute_blob` are supported without additional code. The remaining mismatches are limited to prompt/tone assumptions and apparel-only heuristics, not data availability.


