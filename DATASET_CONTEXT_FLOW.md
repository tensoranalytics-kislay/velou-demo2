# DatasetContext End-to-End Flow

This document describes how `DatasetContext` flows from catalog ingestion through to LLM prompts, ensuring the assistant adapts to the catalog's vertical and available facets.

## Type Definition

```typescript
// src/lib/catalog/datasetInspector.ts
export interface DatasetContext {
  vertical?: string; // e.g. apparel, skincare, furniture, electronics
  dominantPriceCurrency?: string;
  hasPriceData: boolean;
  hasImages: boolean;
  sampleCategories: string[];
  primaryFacets: string[]; // e.g. size, color, material, occasion, room, skin_type
  recommendedSearchExamples: string[]; // 3-6 natural language queries
  qualityNotes: string[]; // warnings about data quality
}
```

## Flow Overview

```
CSV Ingestion → DatasetContext Inference → Storage (BrandConfig) → Retrieval → Orchestrator → Prompt Builders
```

## Step-by-Step Flow

### 1. Catalog Ingestion (`src/lib/catalog/ingestUnifiedCsv.ts`)

During CSV ingestion, after processing the first 200 rows:

- Collects up to 50 sample rows
- Calls `inferDatasetContextFromRows()` (non-blocking)
- Returns `DatasetContext` in `IngestionSummary`

**Key Code:**
```typescript
// After processing rows...
if (options?.enableContextInference !== false && sampleRows.length > 0) {
  const context = await inferDatasetContextFromRows({
    sampleRows,
    stats: summary.coreStats,
    adminHints: options?.adminHints,
  });
  summary.datasetContext = context;
}
```

### 2. Storage (`src/app/api/admin/catalog/upload/route.ts`)

After successful ingestion, `DatasetContext` is persisted to `BrandConfig`:

```typescript
if (summary.datasetContext) {
  await prisma.brandConfig.upsert({
    where: { id: 1 },
    update: {
      datasetContext: summary.datasetContext as unknown as Prisma.InputJsonValue,
    },
    // ... create if needed
  });
}
```

**Database Schema:**
```prisma
model BrandConfig {
  id                    Int      @id @default(1)
  // ... other fields ...
  datasetContext        Json?    // Stores DatasetContext inferred from catalog ingestion
}
```

### 3. Retrieval (`src/lib/catalog/getDatasetContext.ts`)

Helper function retrieves `DatasetContext` from `BrandConfig`:

```typescript
export async function getDatasetContext(): Promise<DatasetContext | null> {
  const config = await prisma.brandConfig.findUnique({
    where: { id: 1 },
    select: { datasetContext: true },
  });
  return config?.datasetContext as DatasetContext | null;
}
```

### 4. API Route (`src/app/api/assistant/route.ts`)

The assistant API route retrieves `DatasetContext` and passes it to the orchestrator:

```typescript
// Retrieve DatasetContext from BrandConfig if not provided in conversationContext
const datasetContext = body.conversationContext?.datasetContext ?? (await getDatasetContext());

// Merge into conversationContext
const enrichedConversationContext: ConversationContext | undefined = body.conversationContext
  ? {
      ...body.conversationContext,
      datasetContext: datasetContext ?? body.conversationContext.datasetContext ?? null,
    }
  : datasetContext
    ? { datasetContext }
    : undefined;

const result = await handleAssistantQuery({
  // ... other params ...
  conversationContext: enrichedConversationContext,
});
```

### 5. Orchestrator (`src/lib/llm/orchestrator/index.ts`)

The orchestrator extracts `DatasetContext` from `ConversationContext` and passes it to flow functions:

```typescript
export type ConversationContext = {
  lastIntent?: AssistantIntent | null;
  lastConstraints?: SearchConstraints | null;
  lastShownProductIds?: string[];
  lastUserQuery?: string | null;
  datasetContext?: DatasetContext | null; // ← Added here
};

export async function handleAssistantQuery(input: AssistantQueryInput): Promise<AssistantQueryResult> {
  const datasetContext = input.conversationContext?.datasetContext ?? null;
  
  // Pass to flow functions
  if (intent === 'pdp_suitability' && input.productContextId) {
    result = await runPdpFlow(input.productContextId, constraints, input.message, datasetContext);
  } else {
    result = await runDiscoveryFlow(constraints, input.message, intent, datasetContext);
  }
}
```

### 6. Prompt Builders (`src/lib/llm/prompts.ts`)

Prompt builders accept `DatasetContext | null` and gracefully degrade to generic language when unavailable:

**Intent & Constraints Prompt:**
```typescript
export const buildIntentAndConstraintsPrompt = (
  datasetContext?: DatasetContext | null,
): string => {
  const verticalLine = datasetContext?.vertical
    ? `This merchant primarily sells ${datasetContext.vertical} products, but the unified schema also supports adjacent verticals.`
    : 'This merchant uses a unified catalog schema that can represent apparel, beauty, home, electronics, and other industries.';
  
  const categoriesLine = datasetContext?.sampleCategories?.length
    ? `Example catalog categories / product types: ${formatList(datasetContext.sampleCategories)}.`
    : 'Map user language to catalog categories/product types using the ontology provided outside this prompt.';
  
  const facetsLine = datasetContext?.primaryFacets?.length
    ? `High-signal facets commonly available: ${formatList(datasetContext.primaryFacets)}.`
    : 'Facet coverage follows the unified schema: colors, sizes, materials, seasons, occasions, useCases, styleTags, benefits, claims, sensoryProfile, compatibility, brands, genders, ageGroups, conditions, custom labels.';
  
  // ... rest of prompt
};
```

**Final Response Prompt:**
```typescript
export const buildFinalResponsePrompt = (
  datasetContext?: DatasetContext | null,
): string => {
  const intro = datasetContext?.vertical
    ? `You are a helpful product discovery assistant for this merchant's ${datasetContext.vertical} catalog.`
    : `You are a helpful product discovery assistant for this merchant's product catalog.`;
  
  const attributeGuidance = datasetContext?.primaryFacets?.length
    ? `When explaining why products fit, lean on high-signal facets such as ${formatList(datasetContext.primaryFacets)} plus any other relevant attributes (benefits, useCases, styleTags, compatibility, sensoryProfile, materials, etc.).`
    : `When explaining why products fit, lean on relevant attributes from the unified schema (benefits, useCases, styleTags, compatibility, sensoryProfile, materials, seasons, occasions, etc.).`;
  
  // ... rest of prompt
};
```

## Admin UI Display

The admin catalog page (`src/app/admin/catalog/page.tsx`) displays the Dataset Profile with a note explaining its usage:

```tsx
<div className="mb-4 flex items-start justify-between">
  <h3 className="text-lg font-medium text-slate-900">Dataset Profile</h3>
  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
    Active
  </span>
</div>
<p className="mb-4 text-sm text-slate-600">
  This metadata is automatically used to adapt LLM prompts and search behavior to your catalog's vertical and available facets, making the assistant industry-agnostic and schema-driven.
</p>
```

## Graceful Degradation

All prompt builders and orchestrator functions handle `null` `DatasetContext` gracefully:

- **When `DatasetContext` is available**: Prompts use vertical-specific language, example categories, and primary facets
- **When `DatasetContext` is `null`**: Prompts fall back to generic, industry-agnostic language that works across all verticals

This ensures the system works even if:
- Context inference fails during ingestion
- BrandConfig doesn't have `datasetContext` yet
- LLM inference is unavailable

## Migration Required

To enable this feature, run:

```bash
npx prisma migrate dev --name add_dataset_context_to_brand_config
```

This adds the `datasetContext Json?` field to the `BrandConfig` model.

