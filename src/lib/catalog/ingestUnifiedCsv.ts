/**
 * Unified CSV Ingestion - Streaming parser and product upsert
 */

import { parse } from 'csv-parse';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { prisma } from '../db';
import type { Prisma } from '@prisma/client';
import { IngestionMode } from '@prisma/client';
import type {
  CatalogRowValidationResult,
  CatalogValidationIssue,
  DatasetCoreStats,
  UnifiedVendorCatalogRow,
} from './types';
import {
  createEmptyStats,
  normalizeUnifiedRow,
  updateDatasetCoreStats,
  validateUnifiedRow,
} from './validation';
import { UNIFIED_CATALOG_SCHEMA } from './unifiedSchemaConfig';
import { logger } from '../telemetry/logger';
import { inferDatasetContextFromRows, type DatasetContext } from './datasetInspector';
import { parseLoccitaneAttributes } from '../loccitane/attributeParser';

const MAX_SAMPLE_ROWS = 50;

export interface IngestionSummary {
  totalRows: number;
  inserted: number;
  updated: number;
  invalidRows: number;
  issues: CatalogValidationIssue[];
  coreStats: DatasetCoreStats;
  datasetContext?: DatasetContext;
  deactivated?: number;
  batchId?: string;
}

/**
 * Parse price string to cents
 * Handles: "$19.99", "19.99 USD", "19,99", etc.
 */
function parsePriceToCents(priceStr: string | null | undefined): number | null {
  if (!priceStr) return null;
  const normalized = priceStr.replace(/,/g, '').trim();
  const numberMatch = normalized.match(/(\d+(\.\d+)?)/);
  if (!numberMatch) return null;
  const amount = Number.parseFloat(numberMatch[1]);
  if (Number.isNaN(amount)) return null;
  return Math.round(amount * 100);
}

/**
 * Normalize stock status to Prisma enum
 */
function normalizeStockStatus(
  status: string | null | undefined
): 'in_stock' | 'low_stock' | 'out_of_stock' {
  if (!status) return 'in_stock';
  const normalized = status.toLowerCase().trim();
  if (normalized === 'out_of_stock' || normalized === 'out of stock') {
    return 'out_of_stock';
  }
  if (normalized === 'low_stock' || normalized === 'low stock') {
    return 'low_stock';
  }
  if (normalized === 'preorder' || normalized === 'discontinued') {
    return 'out_of_stock';
  }
  return 'in_stock';
}

/**
 * Parse product_details pipe_list into key:value object
 * 
 * TODO: Enhanced attribute parsing
 * See: docs/loccitane_multiview_retrieval.md
 * 
 * Future enhancement: Parse "velou_attribute:Key:Value" entries into structured
 * attributes (concerns, skinTypes, ingredients, etc.) for concept-based retrieval.
 * Will be implemented in: src/lib/loccitane/attributeParser.ts
 */
function parseProductDetails(details: string[] | null | undefined): Record<string, string> | null {
  if (!details || details.length === 0) return null;
  const result: Record<string, string> = {};
  for (const item of details) {
    const colonIndex = item.indexOf(':');
    if (colonIndex > 0) {
      const key = item.slice(0, colonIndex).trim();
      const value = item.slice(colonIndex + 1).trim();
      if (key && value) {
        result[key] = value;
      }
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse attribute_blob into structured extensible attributes
 * Format: "namespace:Key:Value,namespace:Key2:Value2"
 */
function parseAttributeBlob(blob: string | null | undefined): Record<string, Record<string, string>> | null {
  if (!blob) return null;
  const result: Record<string, Record<string, string>> = {};
  
  // Try JSON first
  try {
    const parsed = JSON.parse(blob);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, Record<string, string>>;
    }
  } catch {
    // Not JSON, try pipe/comma delimited format
  }
  
  // Parse comma-delimited namespace:Key:Value format
  const items = blob.split(',').map((item) => item.trim()).filter(Boolean);
  for (const item of items) {
    const parts = item.split(':');
    if (parts.length >= 3) {
      const namespace = parts[0].trim();
      const key = parts[1].trim();
      const value = parts.slice(2).join(':').trim(); // Handle values with colons
      if (namespace && key && value) {
        if (!result[namespace]) {
          result[namespace] = {};
        }
        result[namespace][key] = value;
      }
    }
  }
  
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Generate stable product ID from vendorId + product_id
 */
function generateProductId(vendorId: string, productId: string): string {
  // Use vendorId prefix to avoid collisions across vendors
  // Format: {vendorId}_{productId} (sanitized)
  const sanitizedVendor = vendorId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedProduct = productId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${sanitizedVendor}_${sanitizedProduct}`;
}

/**
 * Map unified row to Product Prisma input
 */
function mapRowToProduct(
  row: UnifiedVendorCatalogRow,
  vendorId: string,
  batchId: string,
  merchantId: string
): Prisma.ProductUpsertArgs {
  const productId = generateProductId(vendorId, row.product_id!);
  
  // Build attributes JSON following ProductAttributes interface
  const attributes: Record<string, unknown> = {};
  
  // Identity & Linking fields (stored as-is for reference)
  if (row.related_id) attributes.related_id = row.related_id;
  if (row.external_sku) attributes.external_sku = row.external_sku;
  if (row.barcode) attributes.barcode = row.barcode;
  if (row.parent_id) attributes.parent_id = row.parent_id;
  if (row.image_url_alt1) attributes.image_url_alt1 = row.image_url_alt1;
  if (row.image_url_alt2) attributes.image_url_alt2 = row.image_url_alt2;
  if (row.image_url_alt3) attributes.image_url_alt3 = row.image_url_alt3;
  
  // Classification (stored as-is for reference)
  if (row.vertical) attributes.vertical = row.vertical;
  if (row.taxon_path) attributes.taxon_path = row.taxon_path;
  
  // Map to ProductAttributes fields with camelCase naming
  // useCases from usage_contexts (pipe_list)
  if (row.usage_contexts && row.usage_contexts.length > 0) {
    attributes.useCases = row.usage_contexts;
  }
  
  // styleTags from style_tags (pipe_list)
  if (row.style_tags && row.style_tags.length > 0) {
    attributes.styleTags = row.style_tags;
  }
  
  // Commercial fields (stored as-is for reference)
  if (row.price_valid_until) attributes.price_valid_until = row.price_valid_until;
  if (row.inventory_quantity) {
    const qty = Number.parseInt(row.inventory_quantity, 10);
    if (!Number.isNaN(qty)) attributes.inventory_quantity = qty;
  }
  if (row.lead_time_days) {
    const days = Number.parseInt(row.lead_time_days, 10);
    if (!Number.isNaN(days)) attributes.lead_time_days = days;
  }
  
  // shipRegions from ship_regions (pipe_list)
  if (row.ship_regions && row.ship_regions.length > 0) {
    attributes.shipRegions = row.ship_regions;
  }
  
  // Copy fields
  if (row.short_title) attributes.short_title = row.short_title;
  
  // bulletHighlights from bullet_highlights (pipe_list)
  if (row.bullet_highlights && row.bullet_highlights.length > 0) {
    attributes.bulletHighlights = row.bullet_highlights;
  }
  
  // productHighlights (string)
  if (row.product_highlights) {
    attributes.productHighlights = row.product_highlights;
  }
  
  const productDetails = parseProductDetails(row.product_details);
  if (productDetails) attributes.product_details = productDetails;
  
  // Parse L'Occitane structured attributes from product_details
  // This enables multi-view retrieval (concept-based search)
  if (row.product_details && row.product_details.length > 0) {
    const structuredAttrs = parseLoccitaneAttributes(row.product_details, attributes);
    // Only add if we found any structured data (non-empty arrays or non-null values)
    if (
      structuredAttrs.concerns.length > 0 ||
      structuredAttrs.skinTypes.length > 0 ||
      structuredAttrs.hairTypes.length > 0 ||
      structuredAttrs.applicationAreas.length > 0 ||
      structuredAttrs.productType ||
      structuredAttrs.formula ||
      structuredAttrs.featuredIngredients.length > 0 ||
      structuredAttrs.allIngredients.length > 0 ||
      structuredAttrs.madeWithout.length > 0 ||
      structuredAttrs.ageGroups.length > 0 ||
      structuredAttrs.genders.length > 0
    ) {
      attributes.loccitaneStructured = structuredAttrs;
    }
  }
  
  if (row.care_instructions) attributes.care_instructions = row.care_instructions;
  
  // materials: handle both string and pipe_list formats
  if (row.materials) {
    // If materials is a pipe-delimited string, parse it; otherwise store as string
    if (typeof row.materials === 'string' && row.materials.includes('|')) {
      const materialsList = row.materials
        .split('|')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (materialsList.length > 0) {
        attributes.materials = materialsList;
        // Also set material (singular) for backward compatibility
        attributes.material = materialsList[0];
      }
    } else {
      // Single material string
      attributes.material = row.materials;
      attributes.materials = [row.materials];
    }
  }
  
  // ingredients: handle both string and pipe_list formats
  if (row.ingredients) {
    if (typeof row.ingredients === 'string' && row.ingredients.includes('|')) {
      const ingredientsList = row.ingredients
        .split('|')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (ingredientsList.length > 0) {
        attributes.ingredients = ingredientsList;
      }
    } else {
      attributes.ingredients = [row.ingredients];
    }
  }
  
  if (row.dimensions) attributes.dimensions = row.dimensions;
  if (row.weight) attributes.weight = row.weight;
  if (row.size_fit_notes) attributes.sizeFitNotes = row.size_fit_notes;
  
  // Experience & Efficacy fields
  // benefits from benefits (pipe_list)
  if (row.benefits && row.benefits.length > 0) {
    attributes.benefits = row.benefits;
  }
  
  // claims from claims (pipe_list)
  if (row.claims && row.claims.length > 0) {
    attributes.claims = row.claims;
  }
  
  // safetyCompliance from safety_compliance (pipe_list)
  if (row.safety_compliance && row.safety_compliance.length > 0) {
    attributes.safetyCompliance = row.safety_compliance;
  }
  
  if (row.usage_instructions) {
    attributes.usageInstructions = row.usage_instructions;
  }
  
  if (row.sensory_profile) {
    attributes.sensoryProfile = row.sensory_profile;
  }
  
  // compatibility from compatibility (pipe_list)
  if (row.compatibility && row.compatibility.length > 0) {
    attributes.compatibility = row.compatibility;
  }
  
  // Collection and label
  if (row.collection) {
    attributes.collection = row.collection;
  }
  if (row.label) {
    attributes.label = row.label;
  }
  
  // Media fields
  if (row.media_gallery) {
    try {
      attributes.media_gallery = JSON.parse(row.media_gallery);
    } catch {
      // Invalid JSON, skip
    }
  }
  if (row.video_url) attributes.video_url = row.video_url;
  if (row.attribute_chips && row.attribute_chips.length > 0) {
    attributes.attribute_chips = row.attribute_chips;
  }
  if (row.cta_url_override) attributes.cta_url_override = row.cta_url_override;
  
  // Extensible attributes from attribute_blob
  const extensible = parseAttributeBlob(row.attribute_blob);
  if (extensible) {
    attributes.extensible = extensible;
  }
  
  // Telemetry
  if (row.analytics_sku) attributes.analytics_sku = row.analytics_sku;
  if (row.pdp_tracking_id) attributes.pdp_tracking_id = row.pdp_tracking_id;
  
  // Build description from available fields
  const descriptionParts: string[] = [];
  if (row.description) descriptionParts.push(row.description);
  if (row.bullet_highlights && row.bullet_highlights.length > 0) {
    descriptionParts.push(row.bullet_highlights.join('. '));
  }
  if (row.product_highlights) descriptionParts.push(row.product_highlights);
  const finalDescription = descriptionParts.join('\n\n') || row.title || row.short_title || '';

  // Parse prices
  const priceCents = parsePriceToCents(row.price) ?? 0; // Default to 0 if missing
  const salePriceCents = parsePriceToCents(row.sale_price);
  const currency = row.currency?.toUpperCase() || 'USD';
  
  // Determine category (prefer category, fallback to subcategory, then taxon_path)
  const category = row.category || row.subcategory || 'Uncategorized';
  const subcategory = row.subcategory || null;
  
  // Stock status
  const stockStatus = normalizeStockStatus(row.inventory_status);
  
  // Ensure attributes is a plain object (not a Prisma JsonValue wrapper)
  // This prevents any issues with reserved keywords or invalid field names
  const cleanAttributes = JSON.parse(JSON.stringify(attributes)) as Prisma.InputJsonValue;

  // Explicitly construct the return object to avoid any property leakage
  // Use Object.create(null) to ensure no prototype pollution
  const createObj: Prisma.ProductCreateInput = {
    id: productId,
    merchant: { connect: { id: merchantId } },
    title: row.title || row.short_title || 'Untitled Product',
    description: finalDescription,
    imageUrl: row.image_url_primary || '',
    productUrl: row.product_url || '',
    priceCents,
    salePriceCents: salePriceCents ?? null,
    currency,
    category,
    subcategory: subcategory ?? null,
    brand: row.brand || null,
    attributes: cleanAttributes,
    stockStatus,
    vendorId,
    sourceId: row.product_id!,
    isActive: true,
    lastIngestBatchId: batchId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  const updateObj: Prisma.ProductUpdateInput = {
    title: row.title || row.short_title || 'Untitled Product',
    description: finalDescription,
    imageUrl: row.image_url_primary || '',
    productUrl: row.product_url || '',
    priceCents,
    salePriceCents: salePriceCents ?? null,
    currency,
    category,
    subcategory: subcategory ?? null,
    brand: row.brand || null,
    attributes: cleanAttributes,
    stockStatus,
    vendorId,
    sourceId: row.product_id!,
    isActive: true,
    lastIngestBatchId: batchId,
  };

  return {
    where: { id: productId },
    create: createObj,
    update: updateObj,
  };
}

/**
 * Stream CSV rows and yield normalized + validated results
 */
export async function* parseUnifiedCsv(
  stream: NodeJS.ReadableStream
): AsyncGenerator<{
  rowIndex: number;
  raw: Record<string, string>;
  normalized: UnifiedVendorCatalogRow;
  validation: CatalogRowValidationResult;
}> {
  const parser = parse({
    columns: (header) => header.map((name: string) => name.trim().toLowerCase().replace(/\s+/g, '_')),
    skip_empty_lines: true,
    relax_column_count: true, // Allow missing columns
  });

  // Collect all records first (for reliable async iteration)
  const records: Array<Record<string, string>> = [];
  let headers: string[] = [];

  await new Promise<void>((resolve, reject) => {
    // Validate header when parser starts
    parser.on('readable', function () {
      let record;
      // Keep reading until null (all available records in this chunk)
      while ((record = parser.read()) !== null) {
        // First record contains the header column names (csv-parse with columns option)
        // But actually, with columns callback, the first data row is already parsed
        // So we need to validate headers from the first record's keys
        if (headers.length === 0 && record) {
          headers = Object.keys(record);
          const requiredHeaders = ['product_id', 'title', 'product_url'];
          const hasRequired = requiredHeaders.some((h) => headers.includes(h));
          if (!hasRequired) {
            reject(
              new Error(
                `CSV header missing required columns. Expected at least one of: ${requiredHeaders.join(', ')}`
              )
            );
            return;
          }
        }
        records.push(record);
      }
    });

    parser.on('error', (err) => {
      reject(err);
    });

    parser.on('end', () => {
      resolve();
    });

    stream.pipe(parser);
    
    stream.on('error', (err) => {
      reject(err);
    });
  });

  // Process records and yield (all records are data rows, header already skipped by csv-parse)
  let rowIndex = 0;
  for (const record of records) {
    rowIndex++;
    const raw = record as Record<string, string>;
    const { normalized, parsingIssues } = normalizeUnifiedRow(raw);
    const validation = validateUnifiedRow(normalized, UNIFIED_CATALOG_SCHEMA, rowIndex, parsingIssues);

    yield {
      rowIndex,
      raw,
      normalized,
      validation,
    };
  }
}

/**
 * Upsert a product from a unified row
 */
export async function upsertProductFromUnifiedRow(
  row: UnifiedVendorCatalogRow,
  vendorId: string,
  batchId: string,
  merchantId: string
): Promise<{ created: boolean }> {
  // First, sanitize the row object to remove any unexpected fields
  // This prevents CSV columns like "new" from leaking through
  // Use explicit property access to ensure only known fields are included
  const validRowFields = new Set([
    'product_id', 'related_id', 'external_sku', 'barcode', 'parent_id',
    'product_url', 'image_url_primary', 'image_url_alt1', 'image_url_alt2', 'image_url_alt3',
    'brand', 'collection', 'label', 'vertical', 'category', 'subcategory', 'taxon_path',
    'usage_contexts', 'style_tags', 'currency', 'price', 'sale_price', 'price_valid_until',
    'inventory_status', 'inventory_quantity', 'lead_time_days', 'ship_regions',
    'title', 'short_title', 'description', 'bullet_highlights', 'product_highlights',
    'product_details', 'care_instructions', 'materials', 'ingredients', 'dimensions',
    'weight', 'size_fit_notes', 'benefits', 'claims', 'safety_compliance',
    'usage_instructions', 'sensory_profile', 'compatibility', 'media_gallery',
    'video_url', 'attribute_chips', 'cta_url_override', 'attribute_blob',
    'analytics_sku', 'pdp_tracking_id'
  ]);
  
  // Check for unexpected fields in the row object
  const rowKeys = Object.keys(row as any);
  const unexpectedRowKeys = rowKeys.filter(k => !validRowFields.has(k));
  if (unexpectedRowKeys.length > 0) {
    logger.warn('Unexpected fields in row object', {
      unexpectedKeys: unexpectedRowKeys,
      allKeys: rowKeys,
    });
  }
  
  // Build sanitized row by only including valid fields
  const sanitizedRow: UnifiedVendorCatalogRow = {} as UnifiedVendorCatalogRow;
  for (const key of validRowFields) {
    if (key in row) {
      (sanitizedRow as any)[key] = (row as any)[key];
    } else {
      (sanitizedRow as any)[key] = null;
    }
  }
  
  const upsertArgs = mapRowToProduct(sanitizedRow, vendorId, batchId, merchantId);
  
  // Double-check: ensure the create and update objects don't have any unexpected fields
  // Filter out any field that's not in our whitelist
  const validPrismaFields = new Set([
    'id',
    'title',
    'description',
    'imageUrl',
    'productUrl',
    'priceCents',
    'salePriceCents',
    'currency',
    'category',
    'subcategory',
    'brand',
    'attributes',
    'stockStatus',
    'vendorId',
    'sourceId',
    'isActive',
    'lastIngestBatchId',
    'createdAt',
    'updatedAt',
    'merchant',
  ]);
  
  // Build sanitized objects using explicit property access - no object spread or iteration
  // This prevents any hidden properties from leaking through
  // CRITICAL: Ensure attributes is properly typed as Prisma.JsonValue to prevent Prisma from misinterpreting it
  const cleanAttributes = JSON.parse(JSON.stringify(upsertArgs.create.attributes)) as Prisma.InputJsonValue;
  
  const sanitizedCreate: Prisma.ProductCreateInput = {
    id: upsertArgs.create.id,
    merchant: { connect: { id: merchantId } },
    title: upsertArgs.create.title,
    description: upsertArgs.create.description,
    imageUrl: upsertArgs.create.imageUrl,
    productUrl: upsertArgs.create.productUrl,
    priceCents: upsertArgs.create.priceCents,
    salePriceCents: upsertArgs.create.salePriceCents ?? null,
    currency: upsertArgs.create.currency,
    category: upsertArgs.create.category,
    subcategory: upsertArgs.create.subcategory ?? null,
    brand: upsertArgs.create.brand ?? null,
    attributes: cleanAttributes,
    stockStatus: upsertArgs.create.stockStatus,
    vendorId: upsertArgs.create.vendorId ?? null,
    sourceId: upsertArgs.create.sourceId ?? null,
    isActive: upsertArgs.create.isActive,
    lastIngestBatchId: upsertArgs.create.lastIngestBatchId ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  const cleanUpdateAttributes = JSON.parse(JSON.stringify(upsertArgs.update.attributes)) as Prisma.InputJsonValue;
  
  const sanitizedUpdate: Prisma.ProductUpdateInput = {
    title: upsertArgs.update.title,
    description: upsertArgs.update.description,
    imageUrl: upsertArgs.update.imageUrl,
    productUrl: upsertArgs.update.productUrl,
    priceCents: upsertArgs.update.priceCents,
    salePriceCents: upsertArgs.update.salePriceCents ?? null,
    currency: upsertArgs.update.currency,
    category: upsertArgs.update.category,
    subcategory: upsertArgs.update.subcategory ?? null,
    brand: upsertArgs.update.brand ?? null,
    attributes: cleanUpdateAttributes,
    stockStatus: upsertArgs.update.stockStatus,
    vendorId: upsertArgs.update.vendorId ?? null,
    sourceId: upsertArgs.update.sourceId ?? null,
    isActive: upsertArgs.update.isActive,
    lastIngestBatchId: upsertArgs.update.lastIngestBatchId ?? null,
  };
  
  // Log if we find any unexpected fields
  const createKeys = Object.keys(upsertArgs.create);
  const unexpectedCreateKeys = createKeys.filter(k => !validPrismaFields.has(k));
  if (unexpectedCreateKeys.length > 0) {
    logger.warn('Unexpected fields in create object', {
      productId: upsertArgs.where.id,
      unexpectedKeys: unexpectedCreateKeys,
      allKeys: createKeys,
    });
  }
  
  // Use sanitized objects directly - no JSON serialization that could introduce issues.
  // The sanitizedCreate and sanitizedUpdate are already explicitly constructed with only valid fields.
  const finalCreate = sanitizedCreate;
  const finalUpdate = sanitizedUpdate;
  
  // Final top-level safeguard: if someone ever introduces a top-level "new" field
  // on the Prisma objects, strip it and log loudly. Nested JSON attributes are allowed
  // to contain keys called "new" (e.g., condition:new) and are NOT touched here.
  const hasTopLevelNewInCreate = Object.prototype.hasOwnProperty.call(finalCreate, 'new');
  const hasTopLevelNewInUpdate = Object.prototype.hasOwnProperty.call(finalUpdate, 'new');

  if (hasTopLevelNewInCreate || hasTopLevelNewInUpdate) {
    logger.error('product_upsert_top_level_new_stripped', {
      productId: upsertArgs.where.id,
      hasTopLevelNewInCreate,
      hasTopLevelNewInUpdate,
      createKeys: Object.keys(finalCreate),
      updateKeys: Object.keys(finalUpdate),
    });
    if (hasTopLevelNewInCreate) delete (finalCreate as any).new;
    if (hasTopLevelNewInUpdate) delete (finalUpdate as any).new;
  }
  
  // Final check: ensure objects only have expected keys
  const finalCreateKeys = Object.keys(finalCreate);
  const finalUpdateKeys = Object.keys(finalUpdate);
  const invalidCreateKeys = finalCreateKeys.filter(k => !validPrismaFields.has(k));
  const invalidUpdateKeys = finalUpdateKeys.filter(k => !validPrismaFields.has(k) && k !== 'id');
  
  if (invalidCreateKeys.length > 0 || invalidUpdateKeys.length > 0) {
    logger.error('CRITICAL: Invalid keys in final Prisma objects', {
      productId: upsertArgs.where.id,
      invalidCreateKeys,
      invalidUpdateKeys,
      allCreateKeys: finalCreateKeys,
      allUpdateKeys: finalUpdateKeys,
    });
    // Remove invalid keys
    for (const key of invalidCreateKeys) {
      delete (finalCreate as any)[key];
    }
    for (const key of invalidUpdateKeys) {
      delete (finalUpdate as any)[key];
    }
  }
  
  // In non-production, log the final keys we are about to send to Prisma so it is
  // obvious that no unexpected columns (like "new") are present.
  if (process.env.NODE_ENV !== 'production') {
    logger.debug('product_upsert_final_keys', {
      productId: upsertArgs.where.id,
      finalCreateKeys,
      finalUpdateKeys,
    });
  }
  
  // Construct the final upsert args using Object.assign to ensure clean objects
  const sanitizedUpsertArgs: Prisma.ProductUpsertArgs = {
    where: { id: upsertArgs.where.id },
    create: Object.assign({}, finalCreate) as Prisma.ProductCreateInput,
    update: Object.assign({}, finalUpdate) as Prisma.ProductUpdateInput,
  };
  
  try {
    // Log the actual Prisma call for the first product to debug
    const productId = upsertArgs.where.id;
    if (productId && (productId.includes('_29GE200A22') || productId.includes('_01'))) {
      logger.debug('About to call Prisma.upsert', {
        productId,
        createKeys: Object.keys(finalCreate),
        updateKeys: Object.keys(finalUpdate),
        createObj: JSON.stringify(finalCreate, null, 2).substring(0, 2000),
      });
    }
    
    const result = await prisma.product.upsert(sanitizedUpsertArgs);
    // Check if it was created by comparing createdAt and updatedAt
    const created = result.createdAt.getTime() === result.updatedAt.getTime();
    return { created };
  } catch (error) {
    // Log detailed error information
    logger.error('Failed to upsert product', {
      productId: upsertArgs.where.id,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      createKeys: Object.keys(sanitizedCreate),
      updateKeys: Object.keys(sanitizedUpdate),
      unexpectedCreateKeys,
      rawCreateKeys: Object.keys(upsertArgs.create),
      rawUpdateKeys: Object.keys(upsertArgs.update),
    });
    throw error;
  }
}

/**
 * Ingest CSV stream and upsert products
 */
export async function ingestUnifiedCsvStream(
  stream: NodeJS.ReadableStream,
  vendorId: string,
  merchantId: string,
  options?: {
    adminHints?: { vertical?: string; currency?: string };
    enableContextInference?: boolean;
    mode?: 'FULL_REPLACE' | 'INCREMENTAL';
  }
): Promise<IngestionSummary> {
  const mode = options?.mode ?? 'FULL_REPLACE';
  const batchId = randomUUID();

  const summary: IngestionSummary = {
    totalRows: 0,
    inserted: 0,
    updated: 0,
    invalidRows: 0,
    issues: [],
    coreStats: createEmptyStats(),
    batchId,
  };

  // Track successfully processed product IDs for FULL_REPLACE mode
  const processedProductIds = new Set<string>();

  // Create ingestion run record
  let ingestionRun;
  try {
    ingestionRun = await prisma.catalogIngestionRun.create({
      data: {
        id: batchId,
        merchant: { connect: { id: merchantId } },
        vendorId,
        mode: mode === 'FULL_REPLACE' ? IngestionMode.FULL_REPLACE : IngestionMode.INCREMENTAL,
        totalRows: 0, // Will be updated after processing
        inserted: 0,
        updated: 0,
        invalidRows: 0,
      },
    });
  } catch (error) {
    logger.error('Failed to create ingestion run record', {
      vendorId,
      batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Continue with ingestion even if run record creation fails
  }

  // Collect sample rows for context inference
  const sampleRows: UnifiedVendorCatalogRow[] = [];
  const SAMPLE_THRESHOLD = 200; // Start inference after processing 200 rows

  // Batch processing for faster ingestion
  const BATCH_SIZE = 500; // Process 500 products at a time
  const productBatch: Array<{ rowIndex: number; normalized: UnifiedVendorCatalogRow; validation: CatalogRowValidationResult }> = [];

  const processBatch = async () => {
    if (productBatch.length === 0) return;

    const validProducts = productBatch.filter(item => item.validation.isValid);
    
    if (validProducts.length > 0) {
      try {
        // Use Prisma.sql for bulk upsert (much faster than individual upserts)
        // This uses PostgreSQL's INSERT ... ON CONFLICT which can handle hundreds of rows in one query

        // Bulk upsert using PostgreSQL INSERT ... ON CONFLICT
        // Build SQL with proper JSONB casting
        const valuesParts: string[] = [];
        const allParams: any[] = [];
        let paramCounter = 1;

        for (const { normalized: row } of validProducts) {
          const productId = generateProductId(vendorId, row.product_id!);
          const productData = mapRowToProduct(row, vendorId, batchId, merchantId);
          const now = new Date();
          
          const placeholders = [
            `$${paramCounter++}`, // id
            `$${paramCounter++}`, // merchantId
            `$${paramCounter++}`, // title
            `$${paramCounter++}`, // description
            `$${paramCounter++}`, // imageUrl
            `$${paramCounter++}`, // productUrl
            `$${paramCounter++}`, // priceCents
            `$${paramCounter++}`, // salePriceCents
            `$${paramCounter++}`, // currency
            `$${paramCounter++}`, // category
            `$${paramCounter++}`, // subcategory
            `$${paramCounter++}`, // brand
            `$${paramCounter++}::jsonb`, // attributes (cast to jsonb)
            `$${paramCounter++}::text::"StockStatus"`, // stockStatus (cast to enum)
            `$${paramCounter++}`, // vendorId
            `$${paramCounter++}`, // sourceId
            `$${paramCounter++}`, // isActive
            `$${paramCounter++}`, // lastIngestBatchId
            `$${paramCounter++}`, // createdAt
            `$${paramCounter++}`, // updatedAt
          ];
          
          allParams.push(
            productId,
            merchantId,
            productData.create.title,
            productData.create.description || '',
            productData.create.imageUrl,
            productData.create.productUrl,
            productData.create.priceCents,
            productData.create.salePriceCents ?? null,
            productData.create.currency,
            productData.create.category,
            productData.create.subcategory ?? null,
            productData.create.brand ?? null,
            JSON.stringify(productData.create.attributes), // Will be cast to jsonb
            productData.create.stockStatus,
            productData.create.vendorId ?? null,
            productData.create.sourceId ?? null,
            productData.create.isActive,
            batchId,
            now,
            now,
          );
          
          valuesParts.push(`(${placeholders.join(', ')})`);
        }

        const query = `
          INSERT INTO "Product" (
            "id", "merchantId", "title", "description", "imageUrl", "productUrl",
            "priceCents", "salePriceCents", "currency", "category", "subcategory", "brand",
            "attributes", "stockStatus", "vendorId", "sourceId", "isActive", "lastIngestBatchId",
            "createdAt", "updatedAt"
          )
          VALUES ${valuesParts.join(', ')}
          ON CONFLICT ("id") DO UPDATE SET
            "title" = EXCLUDED."title",
            "description" = EXCLUDED."description",
            "imageUrl" = EXCLUDED."imageUrl",
            "productUrl" = EXCLUDED."productUrl",
            "priceCents" = EXCLUDED."priceCents",
            "salePriceCents" = EXCLUDED."salePriceCents",
            "currency" = EXCLUDED."currency",
            "category" = EXCLUDED."category",
            "subcategory" = EXCLUDED."subcategory",
            "brand" = EXCLUDED."brand",
            "attributes" = EXCLUDED."attributes",
            "stockStatus" = EXCLUDED."stockStatus",
            "vendorId" = EXCLUDED."vendorId",
            "sourceId" = EXCLUDED."sourceId",
            "isActive" = EXCLUDED."isActive",
            "lastIngestBatchId" = EXCLUDED."lastIngestBatchId",
            "updatedAt" = EXCLUDED."updatedAt"
          RETURNING "id", "createdAt", "updatedAt"
        `;

        const results = await prisma.$queryRawUnsafe<any[]>(query, ...allParams);
        
        // Count inserts vs updates
        for (const result of results) {
          const productId = result.id;
          const wasCreated = new Date(result.createdAt).getTime() === new Date(result.updatedAt).getTime();
          if (wasCreated) {
            summary.inserted++;
          } else {
            summary.updated++;
          }
          processedProductIds.add(productId);
        }
      } catch (error) {
        // If batch fails, fall back to individual upserts for this batch
        logger.warn('Batch upsert failed, falling back to individual upserts', {
          error: error instanceof Error ? error.message : String(error),
          batchSize: validProducts.length,
        });
        
        for (const { normalized, rowIndex } of validProducts) {
        try {
          const { created } = await upsertProductFromUnifiedRow(normalized, vendorId, batchId, merchantId);
          if (created) {
            summary.inserted++;
          } else {
            summary.updated++;
          }
          const productId = generateProductId(vendorId, normalized.product_id!);
          processedProductIds.add(productId);
          } catch (err) {
          summary.invalidRows++;
          summary.issues.push({
            level: 'error',
            field: 'upsert',
              message: `Failed to upsert product: ${err instanceof Error ? err.message : String(err)}`,
            rowIndex,
          });
        }
        }
      }
    }

    // Handle invalid rows
    const invalidRows = productBatch.filter(item => !item.validation.isValid);
    for (const { rowIndex, validation } of invalidRows) {
        summary.invalidRows++;
        summary.issues.push(...validation.errors);
      if (validation.warnings.length > 0) {
        summary.issues.push(...validation.warnings);
      }
    }

    productBatch.length = 0; // Clear batch
  };

  try {
    for await (const { rowIndex, normalized, validation } of parseUnifiedCsv(stream)) {
      summary.totalRows++;

      // Update stats
      summary.coreStats = updateDatasetCoreStats(summary.coreStats, normalized, validation);

      // Collect sample rows for context inference (only valid rows)
      if (
        options?.enableContextInference !== false &&
        validation.isValid &&
        sampleRows.length < MAX_SAMPLE_ROWS &&
        summary.totalRows <= SAMPLE_THRESHOLD
      ) {
        sampleRows.push(normalized);
      }

      // Add to batch
      productBatch.push({ rowIndex, normalized, validation });

      // Add warnings to issues (but don't count as invalid yet)
      if (validation.warnings.length > 0) {
        summary.issues.push(...validation.warnings);
      }

      // Process batch when it reaches BATCH_SIZE
      if (productBatch.length >= BATCH_SIZE) {
        await processBatch();
        // Log progress
        if (summary.totalRows % (BATCH_SIZE * 5) === 0) {
          console.log(`   Processed ${summary.totalRows} rows... (${summary.inserted} inserted, ${summary.updated} updated)`);
        }
      }
    }

    // Process remaining batch
    if (productBatch.length > 0) {
      await processBatch();
    }

    // Infer dataset context (non-blocking, optional)
    if (options?.enableContextInference !== false && sampleRows.length > 0) {
      try {
        logger.debug('Starting dataset context inference', {
          vendorId,
          sampleRowsCount: sampleRows.length,
          totalRows: summary.totalRows,
        });

        const context = await inferDatasetContextFromRows({
          sampleRows,
          stats: summary.coreStats,
          adminHints: options?.adminHints,
        });

        summary.datasetContext = context;

        // Log telemetry with detailed info
        logger.info('dataset_context_inferred', {
          vendorId,
          vertical: context.vertical,
          primaryFacets: context.primaryFacets,
          hasPriceData: context.hasPriceData,
          hasImages: context.hasImages,
          hasRecommendedExamples: Boolean(context.recommendedSearchExamples?.length),
          recommendedExamplesCount: context.recommendedSearchExamples?.length || 0,
          recommendedExamples: context.recommendedSearchExamples, // Log actual examples
        });
        
        // Also console.log for immediate visibility
        console.log('[ingestion] DatasetContext inferred:', {
          vertical: context.vertical,
          recommendedSearchExamples: context.recommendedSearchExamples,
          sampleCategories: context.sampleCategories,
          primaryFacets: context.primaryFacets,
        });
      } catch (error) {
        // Don't fail ingestion if context inference fails
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorDetails = error instanceof Error && 'cause' in error ? String(error.cause) : undefined;
        
        logger.warn('Dataset context inference failed (non-blocking)', {
          vendorId,
          error: errorMessage,
          errorDetails,
          sampleRowsCount: sampleRows.length,
          totalRows: summary.totalRows,
        });
        
        // Still set a fallback context so the UI shows something
        summary.datasetContext = {
          hasPriceData: summary.coreStats.rowsWithPrice > 0,
          hasImages: summary.coreStats.rowsWithImage > 0,
          sampleCategories: Array.from(
            new Set(sampleRows.map((r) => r.category).filter(Boolean) as string[])
          ).slice(0, 10),
          primaryFacets: [],
          recommendedSearchExamples: [],
          qualityNotes: [
            `LLM inference unavailable: ${errorMessage}`,
            summary.coreStats.rowsWithPrice === 0 ? 'No price data found' : '',
            summary.coreStats.rowsWithImage === 0 ? 'No image data found' : '',
            summary.coreStats.rowsWithDescription === 0 ? 'No descriptions found' : '',
          ].filter(Boolean),
        };
      }
    } else if (options?.enableContextInference !== false && sampleRows.length === 0) {
      // No sample rows collected - log why
      logger.debug('Dataset context inference skipped: no sample rows collected', {
        vendorId,
        totalRows: summary.totalRows,
        invalidRows: summary.invalidRows,
        enableContextInference: options?.enableContextInference,
      });
    }

    // FULL_REPLACE mode: Deactivate products not in the new CSV
    if (mode === 'FULL_REPLACE' && processedProductIds.size > 0) {
      try {
        const deactivateResult = await prisma.product.updateMany({
          where: {
            merchantId,
            vendorId,
            isActive: true,
            id: {
              notIn: Array.from(processedProductIds),
            },
          },
          data: {
            isActive: false,
            stockStatus: 'out_of_stock', // Mark as discontinued
          },
        });

        summary.deactivated = deactivateResult.count;

        logger.info('FULL_REPLACE deactivation complete', {
          vendorId,
          batchId,
          deactivated: deactivateResult.count,
          processed: processedProductIds.size,
        });
      } catch (error) {
        logger.error('Failed to deactivate missing products', {
          vendorId,
          batchId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't fail ingestion if deactivation fails
      }
    }

    // Update ingestion run record with final stats
    if (ingestionRun) {
      try {
        await prisma.catalogIngestionRun.update({
          where: { id: batchId },
          data: {
            totalRows: summary.totalRows,
            inserted: summary.inserted,
            updated: summary.updated,
            invalidRows: summary.invalidRows,
            deactivated: summary.deactivated ?? null,
          },
        });
      } catch (error) {
        logger.warn('Failed to update ingestion run record', {
          vendorId,
          batchId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.error('CSV ingestion failed', {
      vendorId,
      batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return summary;
}

