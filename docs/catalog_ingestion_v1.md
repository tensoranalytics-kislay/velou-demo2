# Unified Catalog Ingestion v1 - Design Document

## Overview

This document defines the design for a **vendor-agnostic, industry-flexible catalog ingestion system** that accepts a standardized CSV format from any vendor (apparel, furniture, skincare, etc.) and maps it into our existing `Product` schema and search infrastructure.

**Key Principles:**
- **Config-driven**: Column definitions live in TypeScript config, not hardcoded mappings
- **Industry-agnostic**: Unknown fields stored in extensible `attributes` JSON with namespacing
- **LLM-powered inspection**: Auto-detect vertical, currency, and recommended facets from sample data
- **Validation-first**: Clear distinction between hard-required, recommended, and optional fields
- **Non-breaking**: Works alongside existing search/assistant flows without modification

---

## Current System Analysis

### Product Schema (Prisma)

```prisma
model Product {
  id             String      @id
  title          String
  description    String
  imageUrl       String
  priceCents     Int
  currency       String
  category       String      // Indexed
  subcategory    String?
  brand          String?
  attributes     Json        // Flexible JSON for extensible data
  stockStatus    StockStatus @default(in_stock)  // Indexed
  productUrl     String
  salePriceCents Int?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
}
```

**Key Observations:**
- Core fields are typed and indexed (`category`, `stockStatus`)
- `attributes` JSON field is flexible and supports `[key: string]: unknown`
- Current search stack (`src/lib/search/index.ts`) filters on both DB fields and JSON attributes
- Ontology system (`src/lib/search/ontology.ts`) extracts distinct values from `attributes` for validation

### Current Ingestion (`scripts/importCatalogFromCsv.ts`)

**Current Approach:**
- Hardcoded CSV column mapping (Lucky Brand specific)
- Script-based, runs via CLI
- Batch inserts (500 products at a time)
- Clears all products before import
- Manual price parsing, stock status derivation, category extraction

**Limitations:**
- Vendor-specific column names
- No validation UI
- No preview/inspection before import
- No industry detection
- Hardcoded transformations

### Search Stack Integration Points

**Search Constraints** (`src/lib/search/types.ts`):
- Supports filtering on: `category`, `colors`, `fabrics`, `materials`, `sizes`, `occasions`, `seasons`, `useCases`, `brands`, `genders`, `productTypes`, `googleCategories`, etc.
- All attribute filters query `Product.attributes` JSON field

**Attribute Matching** (`src/lib/search/index.ts`):
- `matchesAttributeFilters()` checks JSON attributes via substring/array matching
- Supports flexible attribute keys via `ProductAttributes` type with `[key: string]: unknown`

**Key Insight**: The search stack is already flexible enough to handle industry-agnostic attributes. We just need to ensure ingested data populates `attributes` correctly.

---

## Unified Vendor Catalog Schema (CSV)

### Column Groups

The unified schema organizes columns into logical groups for validation and mapping:

#### 1. **Identity & Linking** (`identity`)
- `product_id` (string, **hard-required**)
- `related_id` (string, optional) - for variants/bundles
- `external_sku`, `barcode`, `parent_id` (string, optional)
- `product_url` (string, **hard-required**)
- `image_url_primary` (string, **recommended**)
- `image_url_alt1..N` (string, optional) - stored in `attributes.media_gallery`
- `brand` (string, optional) - maps to `Product.brand`
- `collection`, `label` (string, optional) - stored in `attributes`

#### 2. **Classification** (`classification`)
- `vertical` (string, optional) - e.g., "apparel", "furniture", "skincare"
- `category` (string, **recommended** if `subcategory`/`taxon_path` missing)
- `subcategory` (string, optional) - maps to `Product.subcategory`
- `taxon_path` (string, optional) - pipe or `>` delimited, e.g., "Apparel > Clothing > Shirts"
- `usage_contexts` (pipe-list, optional) - e.g., "beach wedding|office desk|casual weekend"
- `style_tags` (pipe-list, optional) - e.g., "mid-century|minimalist|clinical clean"

#### 3. **Commercial Data** (`commercial`)
- `currency` (string, **recommended** if `price` provided)
- `price` (string/number, **recommended** for price-aware catalogs)
- `sale_price` (string/number, optional)
- `price_valid_until` (string, optional) - ISO date
- `inventory_status` (string, optional) - "in_stock" | "low_stock" | "preorder" | "discontinued"
- `inventory_quantity` (number, optional)
- `lead_time_days` (number, optional)
- `ship_regions` (pipe-list, optional)

#### 4. **Descriptive Copy** (`copy`)
- `title` (string, **hard-required** OR `short_title` must exist)
- `short_title` (string, optional) - fallback if `title` missing
- `description` (string, **recommended**)
- `bullet_highlights` (pipe-list, optional) - e.g., "Deep Moisture|Vegan Formula|Paraben-Free"
- `product_highlights` (string, optional) - structured reasons (see enrichment)
- `product_details` (pipe-list, optional) - `key:value` pairs, e.g., "velou_attribute:Benefit:Softens Skin"
- `care_instructions` (string, optional)
- `materials` (string, optional) - stored in `attributes.material`
- `ingredients` (string, optional) - stored in `attributes.ingredients`
- `dimensions` (string, optional) - stored in `attributes.dimensions`
- `weight` (string, optional) - stored in `attributes.weight`
- `size_fit_notes` (string, optional)

#### 5. **Experience & Efficacy Signals** (`experience`)
- `benefits` (pipe-list, optional) - e.g., "Hydrates Skin|Nourishes|Softens"
- `claims` (pipe-list, optional) - e.g., "clinically proven", "B Corp"
- `safety_compliance` (pipe-list, optional) - e.g., "UL", "FDA", "CE"
- `usage_instructions` (string, optional)
- `sensory_profile` (string, optional) - e.g., "scent:shea", "finish:matte"
- `compatibility` (pipe-list, optional) - e.g., "skin type:dry", "room size:small", "device:iPhone 15"

#### 6. **Media & Merchandising** (`media`)
- `media_gallery` (json, optional) - JSON array of `{url: string, label?: string}`
- `video_url` (string, optional)
- `attribute_chips` (pipe-list, optional) - pre-selected chip labels for UI
- `cta_url_override` (string, optional) - overrides `product_url` for CTA

#### 7. **Extensible Attributes** (`extensible`)
- `attribute_blob` (json/pipe-list, optional) - structured attributes in `namespace:Key:Value` format
  - Example: `"velou_attribute:Features:Sensitive,velou_attribute:Benefit:Softens Skin"`
  - Stored in `attributes` with namespace prefix preserved

#### 8. **Telemetry Hooks** (`telemetry`)
- `analytics_sku` (string, optional)
- `pdp_tracking_id` (string, optional)

---

## Field Definition Config

### TypeScript Config Structure

```typescript
// src/lib/catalog/unifiedSchemaConfig.ts

export type FieldGroup = 
  | 'identity' 
  | 'classification' 
  | 'commercial' 
  | 'copy' 
  | 'experience' 
  | 'media' 
  | 'extensible' 
  | 'telemetry';

export type FieldType = 'string' | 'number' | 'json' | 'pipe_list' | 'date';

export type RequiredLevel = 'hard' | 'recommended' | 'optional';

export type CatalogFieldDefinition = {
  name: string;                    // CSV column name (case-insensitive, normalized)
  group: FieldGroup;
  type: FieldType;
  requiredLevel: RequiredLevel;
  mapsTo: {
    dbField?: string;              // Direct DB field: "title", "category", "brand"
    attributesPath?: string;        // JSON path in attributes: "material", "usage_contexts"
    transform?: (value: unknown) => unknown;  // Optional transform function
  };
  validation?: {
    pattern?: RegExp;
    enum?: string[];
    min?: number;
    max?: number;
  };
  description?: string;             // Human-readable description for admin UI
};

export const UNIFIED_CATALOG_SCHEMA: CatalogFieldDefinition[] = [
  // Identity & Linking
  {
    name: 'product_id',
    group: 'identity',
    type: 'string',
    requiredLevel: 'hard',
    mapsTo: { dbField: 'id' },
    description: 'Unique product identifier (stable primary key)',
  },
  {
    name: 'product_url',
    group: 'identity',
    type: 'string',
    requiredLevel: 'hard',
    mapsTo: { dbField: 'productUrl' },
    description: 'Product detail page URL',
  },
  {
    name: 'image_url_primary',
    group: 'identity',
    type: 'string',
    requiredLevel: 'recommended',
    mapsTo: { dbField: 'imageUrl' },
    description: 'Primary product image URL',
  },
  {
    name: 'brand',
    group: 'identity',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { dbField: 'brand' },
    description: 'Brand name',
  },
  
  // Classification
  {
    name: 'category',
    group: 'classification',
    type: 'string',
    requiredLevel: 'recommended',  // Required if subcategory/taxon_path missing
    mapsTo: { dbField: 'category' },
    description: 'Primary product category',
  },
  {
    name: 'subcategory',
    group: 'classification',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { dbField: 'subcategory' },
    description: 'Product subcategory',
  },
  {
    name: 'usage_contexts',
    group: 'classification',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { attributesPath: 'usage_contexts' },
    description: 'Pipe-delimited usage contexts (e.g., "beach wedding|office desk")',
  },
  {
    name: 'style_tags',
    group: 'classification',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { attributesPath: 'style_tags' },
    description: 'Aesthetic/style tags (e.g., "mid-century|minimalist")',
  },
  
  // Commercial
  {
    name: 'currency',
    group: 'commercial',
    type: 'string',
    requiredLevel: 'recommended',  // Required if price provided
    mapsTo: { dbField: 'currency' },
    validation: { enum: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY'] },
    description: 'Currency code (ISO 4217)',
  },
  {
    name: 'price',
    group: 'commercial',
    type: 'string',  // Parsed as number
    requiredLevel: 'recommended',
    mapsTo: { 
      dbField: 'priceCents',
      transform: (val) => parsePriceToCents(val),
    },
    description: 'Product price (parsed to cents)',
  },
  {
    name: 'inventory_status',
    group: 'commercial',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { 
      dbField: 'stockStatus',
      transform: (val) => normalizeStockStatus(val),
    },
    validation: { 
      enum: ['in_stock', 'low_stock', 'out_of_stock', 'preorder', 'discontinued'] 
    },
    description: 'Stock status',
  },
  
  // Copy
  {
    name: 'title',
    group: 'copy',
    type: 'string',
    requiredLevel: 'hard',  // OR short_title must exist
    mapsTo: { dbField: 'title' },
    description: 'Product title',
  },
  {
    name: 'short_title',
    group: 'copy',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { attributesPath: 'short_title' },
    description: 'Short product title (fallback if title missing)',
  },
  {
    name: 'description',
    group: 'copy',
    type: 'string',
    requiredLevel: 'recommended',
    mapsTo: { dbField: 'description' },
    description: 'Product description',
  },
  {
    name: 'product_details',
    group: 'copy',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { 
      attributesPath: 'product_details',
      transform: (val) => parseKeyValuePairs(val),  // "key:value" -> {key: value}
    },
    description: 'Pipe-delimited key:value pairs',
  },
  {
    name: 'materials',
    group: 'copy',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { attributesPath: 'material' },
    description: 'Material composition',
  },
  
  // Experience
  {
    name: 'benefits',
    group: 'experience',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { attributesPath: 'benefits' },
    description: 'Pipe-delimited benefit statements',
  },
  {
    name: 'usage_instructions',
    group: 'experience',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { attributesPath: 'usage_instructions' },
    description: 'How to use the product',
  },
  
  // Extensible
  {
    name: 'attribute_blob',
    group: 'extensible',
    type: 'pipe_list',  // Or JSON if vendor provides JSON string
    requiredLevel: 'optional',
    mapsTo: { 
      attributesPath: 'extensible',
      transform: (val) => parseAttributeBlob(val),  // "namespace:Key:Value" -> structured
    },
    description: 'Structured attributes in namespace:Key:Value format',
  },
  
  // ... more fields ...
];
```

### Required Level Rules

**Hard-Required** (row dropped if missing):
- `product_id` - must exist
- `title` OR `short_title` - at least one must exist
- `product_url` - must exist

**Recommended** (warning if missing, but row not dropped):
- `category` OR `subcategory` OR `taxon_path` - at least one classification field
- `description` - at least one descriptive field
- `currency` + `price` - if price-aware catalog
- `image_url_primary` - for visual catalogs

**Optional** (no validation, stored if present):
- All other fields

### Cross-Field Validation

```typescript
// Example validation rules
const CROSS_FIELD_RULES = [
  {
    name: 'title_or_short_title',
    check: (row) => Boolean(row.title || row.short_title),
    level: 'hard',
    message: 'Either "title" or "short_title" must be provided',
  },
  {
    name: 'classification_exists',
    check: (row) => Boolean(row.category || row.subcategory || row.taxon_path),
    level: 'recommended',
    message: 'At least one classification field (category, subcategory, taxon_path) recommended',
  },
  {
    name: 'price_requires_currency',
    check: (row) => !row.price || row.currency,
    level: 'recommended',
    message: 'If "price" is provided, "currency" should also be provided',
  },
];
```

---

## Data Mapping & Storage

### Direct DB Field Mapping

Fields with `mapsTo.dbField` populate typed Prisma fields:

```typescript
{
  product_id → Product.id
  title → Product.title
  description → Product.description
  image_url_primary → Product.imageUrl
  product_url → Product.productUrl
  category → Product.category
  subcategory → Product.subcategory
  brand → Product.brand
  currency → Product.currency
  price → Product.priceCents (via transform)
  sale_price → Product.salePriceCents (via transform)
  inventory_status → Product.stockStatus (via transform)
}
```

### Attributes JSON Mapping

Fields with `mapsTo.attributesPath` populate `Product.attributes` JSON:

```typescript
// Pipe-list fields → arrays
usage_contexts → attributes.usage_contexts: string[]
style_tags → attributes.style_tags: string[]
benefits → attributes.benefits: string[]

// String fields → strings
materials → attributes.material: string
ingredients → attributes.ingredients: string
care_instructions → attributes.care_instructions: string

// Key-value pairs → object
product_details → attributes.product_details: Record<string, string>

// Structured attributes → namespaced object
attribute_blob → attributes.extensible: Record<string, Record<string, string>>
```

### Unknown Columns

Any CSV column not defined in `UNIFIED_CATALOG_SCHEMA` is stored in `attributes.unknown_columns`:

```typescript
attributes.unknown_columns = {
  vendor_specific_field: "value",
  another_field: "value",
}
```

This ensures **zero data loss** and allows future schema expansion.

---

## Industry-Agnostic Design

### Vertical Detection

The system uses an **LLM-powered dataset inspector** to infer the vertical from sample rows:

```typescript
async function inferDatasetContext(
  sampleRows: UnifiedVendorCatalogRow[],
  schemaConfig: CatalogFieldDefinition[],
  minimalAdminHints?: { vertical?: string; currency?: string }
): Promise<DatasetContext> {
  // LLM call with sample data
  // Returns:
  // - vertical: "apparel" | "furniture" | "skincare" | "electronics" | ...
  // - currency: "USD" | "EUR" | ...
  // - primaryFacets: string[] - top 5 most relevant attribute fields
  // - recommendedSearchChips: string[] - suggested UI chips
  // - warnings: string[] - data quality issues
}
```

### Extensible Attributes Namespacing

All vendor-specific or unknown attributes are stored with namespace prefixes:

```typescript
// Example: Skincare product
attributes = {
  // Standard fields
  material: "Shea Butter",
  benefits: ["Hydrates Skin", "Nourishes"],
  
  // Extensible (from attribute_blob)
  extensible: {
    "velou_attribute": {
      "Features": ["Sensitive", "Scented"],
      "Benefit": ["Reduces Dryness", "Softens Skin"],
      "Skin Type": ["Dry", "Sensitive"],
    }
  },
  
  // Unknown columns
  unknown_columns: {
    spf_rating: "30",
    uv_protection: "broad spectrum",
  }
}
```

### Search Integration

The existing search stack (`src/lib/search/index.ts`) already supports flexible attribute filtering:

- `matchesAttributeFilters()` checks `Product.attributes` for any key
- Supports substring matching for string values
- Supports array inclusion for array values
- No code changes needed for new attribute types

**Example**: A furniture catalog with `attributes.room_type: "living room"` will automatically work with search constraints like `occasions: ["living room"]` (if mapped correctly).

---

## Reconfigurable Architecture

### Config File Location

**Primary Config**: `src/lib/catalog/unifiedSchemaConfig.ts`
- Defines `UNIFIED_CATALOG_SCHEMA` array
- Defines `CROSS_FIELD_RULES` array
- Exports types and validation helpers

### Vendor Overrides (Future)

If needed, vendor-specific overrides can be stored in DB:

```typescript
// Future: VendorConfig model
model VendorConfig {
  id          String   @id
  vendorId    String   @unique
  schemaOverrides Json  // Partial CatalogFieldDefinition[] overrides
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**For v1**: No vendor-specific branching. All vendors use the same schema config.

### Transform Functions

Custom transforms are defined in the config:

```typescript
// src/lib/catalog/transforms.ts
export const parsePriceToCents = (value: unknown): number => {
  // Handles "$19.99", "19.99 USD", "19,99", etc.
};

export const normalizeStockStatus = (value: unknown): StockStatus => {
  // Maps "in stock", "available", "in_stock" → "in_stock"
};

export const parseKeyValuePairs = (value: string): Record<string, string> => {
  // "key1:value1,key2:value2" → {key1: "value1", key2: "value2"}
};

export const parseAttributeBlob = (value: string): Record<string, Record<string, string>> => {
  // "namespace:Key:Value,namespace:Key2:Value2" → structured object
};
```

---

## High-Level Components (Implementation Plan)

### 1. Type Definitions

**File**: `src/lib/catalog/types.ts`

```typescript
export type UnifiedVendorCatalogRow = {
  [columnName: string]: string | number | null | undefined;
};

export type CatalogFieldDefinition = { /* ... */ };

export type RowValidationResult = {
  isValid: boolean;
  errors: Array<{ field: string; message: string; level: RequiredLevel }>;
  warnings: Array<{ field: string; message: string }>;
};

export type DatasetContext = {
  vertical: string;
  currency: string;
  primaryFacets: string[];
  recommendedSearchChips: string[];
  warnings: string[];
};
```

### 2. Schema Config

**File**: `src/lib/catalog/unifiedSchemaConfig.ts`

- Exports `UNIFIED_CATALOG_SCHEMA: CatalogFieldDefinition[]`
- Exports `CROSS_FIELD_RULES: CrossFieldRule[]`
- Exports helper functions: `getFieldDefinition(name)`, `getFieldsByGroup(group)`, etc.

### 3. CSV Parser

**File**: `src/lib/catalog/parser.ts`

```typescript
export async function* parseUnifiedCsv(
  stream: ReadableStream | string
): AsyncIterable<UnifiedVendorCatalogRow> {
  // Streams CSV rows, normalizes column names (case-insensitive, snake_case)
  // Yields parsed rows one at a time
}
```

### 4. Row Validator

**File**: `src/lib/catalog/validator.ts`

```typescript
export function validateCatalogRow(
  row: UnifiedVendorCatalogRow,
  schemaConfig: CatalogFieldDefinition[]
): RowValidationResult {
  // Checks hard-required fields
  // Checks recommended fields (warnings)
  // Validates field types, patterns, enums
  // Applies cross-field rules
  // Returns validation result
}
```

### 5. Product Upserter

**File**: `src/lib/catalog/upserter.ts`

```typescript
export async function upsertProductFromUnifiedRow(
  row: UnifiedVendorCatalogRow,
  vendorId: string,
  context: DatasetContext,
  schemaConfig: CatalogFieldDefinition[]
): Promise<{ productId: string; created: boolean }> {
  // Maps row to ProductCreateInput using schema config
  // Applies transforms
  // Stores unknown columns in attributes.unknown_columns
  // Upserts via Prisma (create or update by id)
  // Returns product ID and whether it was created
}
```

### 6. Dataset Inspector (LLM)

**File**: `src/lib/catalog/inspector.ts`

```typescript
export async function inferDatasetContext(
  sampleRows: UnifiedVendorCatalogRow[],
  schemaConfig: CatalogFieldDefinition[],
  minimalAdminHints?: { vertical?: string; currency?: string }
): Promise<DatasetContext> {
  // Calls LLM with sample rows (first 10-20 rows)
  // Prompt: "Analyze this product catalog sample and infer: vertical, currency, primary facets, recommended search chips"
  // Returns structured DatasetContext
  // Uses lightweight LLM model (gpt-4.1-mini) for cost efficiency
}
```

### 7. Ingestion Service (Orchestrator)

**File**: `src/lib/catalog/ingestion.ts`

```typescript
export async function ingestCatalogFromCsv(
  csvStream: ReadableStream | string,
  vendorId: string,
  options?: {
    dryRun?: boolean;
    batchSize?: number;
    skipValidation?: boolean;
  }
): Promise<IngestionResult> {
  // 1. Parse CSV
  // 2. Validate first N rows (sample)
  // 3. Infer dataset context (LLM)
  // 4. Process all rows:
  //    - Validate each row
  //    - Transform to Product
  //    - Batch upsert
  // 5. Return summary: { imported, skipped, errors, warnings }
}
```

### 8. Admin Upload Wizard

**File**: `src/app/admin/catalog-upload/page.tsx`

**Components**:
- `CatalogUploadWizard.tsx` - Main wizard component
- `CsvUploadStep.tsx` - File upload + preview
- `ValidationSummaryStep.tsx` - Shows validation errors/warnings
- `DatasetContextStep.tsx` - Shows auto-detected context + admin corrections
- `ImportProgressStep.tsx` - Shows import progress

**Flow**:
1. Upload CSV file
2. Parse and preview first 10 rows
3. Show validation summary (errors/warnings)
4. Show auto-detected dataset context (LLM)
5. Admin can correct: vertical, currency
6. Confirm import
7. Show progress bar
8. Show final summary

**API Route**: `src/app/api/admin/catalog-upload/route.ts`
- `POST /api/admin/catalog-upload` - Handles file upload, triggers ingestion
- `GET /api/admin/catalog-upload/preview` - Returns preview of first N rows
- `GET /api/admin/catalog-upload/context` - Returns inferred dataset context

---

## Integration Points with Existing System

### 1. Product Schema
- **No changes needed** - Existing `Product` model already supports flexible `attributes` JSON
- New ingestion populates same fields + stores extensible data in `attributes`

### 2. Search Stack
- **No changes needed** - `matchesAttributeFilters()` already supports flexible attribute keys
- New attributes (e.g., `usage_contexts`, `benefits`) automatically work with search constraints

### 3. Ontology System
- **Enhancement**: `getCatalogOntology()` will automatically discover new attribute values from ingested data
- No code changes needed - ontology is dynamically built from `Product.attributes`

### 4. Admin Pages
- **New page**: `/admin/catalog-upload` added to admin layout
- Uses existing admin styling/components (`AdminNav.tsx`, etc.)

### 5. LLM Provider
- **Uses existing**: `src/lib/llm/provider.ts` for dataset inspection
- Uses lightweight model (`gpt-4.1-mini`) for cost efficiency

---

## Migration Strategy

### Phase 1: Config + Types (No DB Changes)
- Create `src/lib/catalog/*` modules
- Define schema config
- Implement parser, validator, upserter
- **No breaking changes** - existing ingestion script continues to work

### Phase 2: Admin UI
- Add `/admin/catalog-upload` page
- Add API routes
- Test with sample CSVs

### Phase 3: LLM Inspector
- Implement `inferDatasetContext()`
- Add to admin wizard
- Test with multiple verticals

### Phase 4: Deprecate Old Script (Optional)
- Keep old script for backward compatibility
- Document migration path for vendors

---

## Summary

**Key Findings from Repo Scan:**

1. **Product Schema**: Already flexible with `attributes` JSON - no schema changes needed
2. **Search Stack**: Already supports industry-agnostic attributes - no code changes needed
3. **Current Ingestion**: Script-based, vendor-specific - needs replacement with config-driven system
4. **Admin Pages**: Existing admin layout can host new upload wizard
5. **LLM Stack**: Already supports dual-model routing - can use lightweight model for inspection

**Main Hooks into Existing System:**

- **Product Model**: Uses existing `Product` schema, populates `attributes` JSON
- **Search**: New attributes automatically work with existing `matchesAttributeFilters()`
- **Ontology**: Auto-discovers new attribute values from ingested data
- **Admin**: New page in existing admin layout
- **LLM**: Uses existing provider for dataset inspection

**Design Principles Achieved:**

✅ Config-driven (TypeScript config, no hardcoding)  
✅ Industry-agnostic (extensible attributes, LLM inspection)  
✅ Non-breaking (works alongside existing search/assistant)  
✅ Validation-first (hard/recommended/optional distinction)  
✅ Reconfigurable (schema config can be extended without code changes)



