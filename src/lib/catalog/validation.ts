/**
 * Validation logic for Unified Catalog Ingestion
 */

import type {
  CatalogRowValidationResult,
  CatalogValidationIssue,
  DatasetCoreStats,
  UnifiedVendorCatalogRow,
} from './types';
import {
  getFieldDefinition,
  type CatalogFieldDefinition,
  UNIFIED_CATALOG_SCHEMA,
} from './unifiedSchemaConfig';

/**
 * Normalize a raw CSV row into UnifiedVendorCatalogRow
 * - Trims strings, converts empty strings to null
 * - Parses pipe_list fields into arrays (returns [] for empty, not null)
 * - Parses numeric fields (price, sale_price, inventory_quantity, lead_time_days)
 * - Uppercases currency
 * - Returns parsing issues for validation warnings
 */
export function normalizeUnifiedRow(
  raw: Record<string, string>
): {
  normalized: UnifiedVendorCatalogRow;
  parsingIssues: Array<{ field: string; message: string }>;
} {
  const normalized: UnifiedVendorCatalogRow = {
    // Identity & Linking
    product_id: null,
    related_id: null,
    external_sku: null,
    barcode: null,
    parent_id: null,
    product_url: null,
    image_url_primary: null,
    image_url_alt1: null,
    image_url_alt2: null,
    image_url_alt3: null,
    brand: null,
    collection: null,
    label: null,

    // Classification
    vertical: null,
    category: null,
    subcategory: null,
    taxon_path: null,
    usage_contexts: null,
    style_tags: null,

    // Commercial
    currency: null,
    price: null,
    sale_price: null,
    price_valid_until: null,
    inventory_status: null,
    inventory_quantity: null,
    lead_time_days: null,
    ship_regions: null,

    // Copy
    title: null,
    short_title: null,
    description: null,
    bullet_highlights: null,
    product_highlights: null,
    product_details: null,
    care_instructions: null,
    materials: null,
    ingredients: null,
    dimensions: null,
    weight: null,
    size_fit_notes: null,

    // Experience
    benefits: null,
    claims: null,
    safety_compliance: null,
    usage_instructions: null,
    sensory_profile: null,
    compatibility: null,

    // Media
    media_gallery: null,
    video_url: null,
    attribute_chips: null,
    cta_url_override: null,

    // Extensible
    attribute_blob: null,

    // Telemetry
    analytics_sku: null,
    pdp_tracking_id: null,
  };

  const parsingIssues: Array<{ field: string; message: string }> = [];

  // Normalize all fields from raw CSV
  for (const [key, value] of Object.entries(raw)) {
    const fieldDef = getFieldDefinition(key);
    if (!fieldDef) {
      // Unknown field - skip (will be stored in attributes.unknown_columns later)
      continue;
    }

    const normalizedKey = fieldDef.name as keyof UnifiedVendorCatalogRow;
    const trimmed = typeof value === 'string' ? value.trim() : String(value).trim();
    const isEmpty = trimmed === '';

    if (isEmpty) {
      // For pipe_list fields, return empty array instead of null
      if (fieldDef.type === 'pipe_list') {
        (normalized[normalizedKey] as any) = [];
      } else {
        normalized[normalizedKey] = null;
      }
      continue;
    }

    // Parse pipe_list fields into arrays
    if (fieldDef.type === 'pipe_list') {
      const items = trimmed
        .split('|')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      // Return empty array instead of null for empty lists
      (normalized[normalizedKey] as any) = items;
    } else if (fieldDef.type === 'number') {
      // Parse numeric fields (inventory_quantity, lead_time_days)
      const numValue = Number.parseFloat(trimmed.replace(/,/g, ''));
      if (Number.isNaN(numValue)) {
        parsingIssues.push({
          field: fieldDef.name,
          message: `Invalid number format: "${trimmed}". Expected a numeric value.`,
        });
        normalized[normalizedKey] = null;
      } else {
        // Store as string to match UnifiedVendorCatalogRow type
        (normalized[normalizedKey] as any) = String(numValue);
      }
    } else if (normalizedKey === 'price' || normalizedKey === 'sale_price') {
      // Validate and normalize price fields (remove commas, dollar signs, but keep as string)
      const cleaned = trimmed.replace(/,/g, '').replace(/[$]/g, '').trim();
      const numValue = Number.parseFloat(cleaned);
      if (Number.isNaN(numValue)) {
        parsingIssues.push({
          field: fieldDef.name,
          message: `Invalid price format: "${trimmed}". Expected a numeric value.`,
        });
        normalized[normalizedKey] = null;
      } else {
        // Store normalized string (commas and $ removed, will be parsed to cents later)
        (normalized[normalizedKey] as any) = cleaned;
      }
    } else if (normalizedKey === 'currency') {
      // Uppercase currency
      (normalized[normalizedKey] as any) = trimmed.toUpperCase();
    } else {
      // String, json, date, etc. - store as trimmed string
      (normalized[normalizedKey] as any) = trimmed;
    }
  }

  return { normalized, parsingIssues };
}

/**
 * Validate a normalized row against the schema
 */
export function validateUnifiedRow(
  row: UnifiedVendorCatalogRow,
  schema: CatalogFieldDefinition[] = UNIFIED_CATALOG_SCHEMA,
  rowIndex?: number,
  parsingIssues?: Array<{ field: string; message: string }>
): CatalogRowValidationResult {
  const errors: CatalogValidationIssue[] = [];
  const warnings: CatalogValidationIssue[] = [];

  // Add warnings for parsing issues
  if (parsingIssues) {
    for (const issue of parsingIssues) {
      warnings.push({
        level: 'warning',
        field: issue.field,
        message: issue.message,
        rowIndex,
      });
    }
  }

  // Hard requirements
  if (!row.product_id || row.product_id.trim() === '') {
    errors.push({
      level: 'error',
      field: 'product_id',
      message: 'product_id is required',
      rowIndex,
    });
  }

  // At least one of title or short_title must exist
  const hasTitle = row.title && row.title.trim() !== '';
  const hasShortTitle = row.short_title && row.short_title.trim() !== '';
  if (!hasTitle && !hasShortTitle) {
    errors.push({
      level: 'error',
      field: 'title',
      message: 'Either "title" or "short_title" must be provided',
      rowIndex,
    });
  }

  // product_url is effectively required (recommended but treated as hard)
  if (!row.product_url || row.product_url.trim() === '') {
    errors.push({
      level: 'error',
      field: 'product_url',
      message: 'product_url is required',
      rowIndex,
    });
  }

  // Recommended fields - warnings only
  const hasClassification =
    (row.category && row.category.trim() !== '') ||
    (row.subcategory && row.subcategory.trim() !== '') ||
    (row.taxon_path && row.taxon_path.trim() !== '') ||
    (row.vertical && row.vertical.trim() !== '');

  if (!hasClassification) {
    warnings.push({
      level: 'warning',
      field: 'classification',
      message: 'At least one classification field (category, subcategory, taxon_path, vertical) is recommended',
      rowIndex,
    });
  }

  // Descriptive copy warning
  const hasDescription = row.description && row.description.trim() !== '';
  if (!hasDescription) {
    warnings.push({
      level: 'warning',
      field: 'description',
      message: 'description is recommended for better search results',
      rowIndex,
    });
  }

  // Price/currency warnings
  const hasPrice = row.price && row.price.trim() !== '';
  const hasCurrency = row.currency && row.currency.trim() !== '';

  if (hasPrice && !hasCurrency) {
    warnings.push({
      level: 'warning',
      field: 'currency',
      message: 'currency should be provided when price is present',
      rowIndex,
    });
  }

  if (!hasPrice) {
    warnings.push({
      level: 'warning',
      field: 'price',
      message: 'price is recommended for price-aware catalogs',
      rowIndex,
    });
  }

  // Image warning
  if (!row.image_url_primary || row.image_url_primary.trim() === '') {
    warnings.push({
      level: 'warning',
      field: 'image_url_primary',
      message: 'image_url_primary is recommended for visual catalogs',
      rowIndex,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Update dataset core stats based on a row validation result
 */
export function updateDatasetCoreStats(
  stats: DatasetCoreStats,
  row: UnifiedVendorCatalogRow,
  rowResult: CatalogRowValidationResult
): DatasetCoreStats {
  const updated = { ...stats };
  updated.totalRows += 1;

  // Core identity: product_id + (title OR short_title) + product_url
  const hasCoreIdentity =
    row.product_id &&
    row.product_id.trim() !== '' &&
    ((row.title && row.title.trim() !== '') || (row.short_title && row.short_title.trim() !== '')) &&
    row.product_url &&
    row.product_url.trim() !== '';

  if (hasCoreIdentity) {
    updated.rowsWithCoreIdentity += 1;
  }

  // Core classification
  const hasClassification =
    (row.category && row.category.trim() !== '') ||
    (row.subcategory && row.subcategory.trim() !== '') ||
    (row.taxon_path && row.taxon_path.trim() !== '') ||
    (row.vertical && row.vertical.trim() !== '');

  if (hasClassification) {
    updated.rowsWithCoreClassification += 1;
  }

  // Price
  if (row.price && row.price.trim() !== '') {
    updated.rowsWithPrice += 1;
  }

  // Currency
  if (row.currency && row.currency.trim() !== '') {
    updated.rowsWithCurrency += 1;
  }

  // Image
  if (row.image_url_primary && row.image_url_primary.trim() !== '') {
    updated.rowsWithImage += 1;
  }

  // Description
  if (row.description && row.description.trim() !== '') {
    updated.rowsWithDescription += 1;
  }

  // Category
  if (row.category && row.category.trim() !== '') {
    updated.rowsWithCategory += 1;
  }

  // Subcategory
  if (row.subcategory && row.subcategory.trim() !== '') {
    updated.rowsWithSubcategory += 1;
  }

  // Brand
  if (row.brand && row.brand.trim() !== '') {
    updated.rowsWithBrand += 1;
  }

  return updated;
}

/**
 * Create initial empty stats
 */
export function createEmptyStats(): DatasetCoreStats {
  return {
    totalRows: 0,
    rowsWithCoreIdentity: 0,
    rowsWithCoreClassification: 0,
    rowsWithPrice: 0,
    rowsWithCurrency: 0,
    rowsWithImage: 0,
    rowsWithDescription: 0,
    rowsWithCategory: 0,
    rowsWithSubcategory: 0,
    rowsWithBrand: 0,
  };
}

