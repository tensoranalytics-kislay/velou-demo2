/**
 * Enriched CSV to Product Mapping
 * 
 * Maps enriched CSV rows to Prisma Product model.
 * 
 * MAPPING DOCUMENTATION:
 * 
 * CSV Column → Product Column → Attributes JSON (fallback)
 * 
 * Core Fields:
 * - id → Product.id (sanitized with vendorId prefix)
 * - item_group_id → Product.sourceId (for deduplication)
 * - title_clean → Product.title
 * - description_clean → Product.description
 * - image_link → Product.imageUrl
 * - link_base → Product.productUrl
 * - price → Product.priceCents (parsed to cents)
 * - sale_price → Product.salePriceCents (parsed to cents)
 * - availability → Product.stockStatus (normalized)
 * - brand → Product.brand
 * - google_product_category → Product.category
 * - product_type → Product.subcategory
 * - color → Product.color
 * - material → Product.material
 * 
 * Enriched Indexed Columns (direct mapping):
 * - silhouette_cut → Product.silhouetteCut
 * - length → Product.length
 * - sleeve → Product.sleeve
 * - neckline → Product.neckline
 * - closure_construction → Product.closureConstruction
 * - lined → Product.lined (boolean, normalized)
 * - fit_preference → Product.fitPreference
 * - rise_waist → Product.riseWaist
 * - stretch_level → Product.stretchLevel
 * - body_intent → Product.bodyIntent
 * - comfort_intent → Product.comfortIntent
 * - fabric_family → Product.fabricFamily (also → Product.fabric)
 * - handfeel → Product.handfeel
 * - warmth_weight → Product.warmthWeight
 * - breathability → Product.breathability
 * - opacity → Product.opacity
 * - wrinkle_behavior → Product.wrinkleBehavior
 * - formality_level → Product.formalityLevel (normalized)
 * - occasion_context → Product.occasionContext (array, comma-split)
 * - dress_code → Product.dressCode
 * - seasonal_cues → Product.seasonalCues (also → Product.season)
 * - temperature_intent → Product.temperatureIntent (normalized)
 * - humidity_friendly → Product.humidityFriendly (boolean, normalized)
 * - movement_needs → Product.movementNeeds
 * - problem_solutions → Product.problemSolutions (array, comma-split)
 * - function_features → Product.functionFeatures (array, comma-split)
 * - color_shade → Product.colorShade (normalized)
 * - color_undertone → Product.colorUndertone (normalized)
 * - multicolor → Product.multicolor (boolean, normalized)
 * - seasonal_palette → Product.seasonalPalette
 * - inclusivity_sizing → Product.inclusivitySizing
 * 
 * Variant-level data (stored in attributes JSON):
 * - variant_sizes → Product.attributes.sizes (array for filtering)
 * - variant_colors → Product.attributes.variant_colors (array for filtering)
 * 
 * Attributes JSON (fallback for less-frequently-queried fields):
 * - sizing_notes, care_requirements, style_labels, vibe_mood, pattern_print,
 *   detailing, finish, modesty_cues, rain_wind, travel_features, layering_intent,
 *   pairing_intent, pockets, lining_type, bra_solution, slit, neckline_depth,
 *   waist_structure, hem_style, collar_type, price_band, deal_intent, value_framing,
 *   eco_materials, certifications, origin, durability_notes, adaptive_features,
 *   sensory_friendly, social_proof, llm_confidence_overall, llm_evidence_json,
 *   additional_image_links, set_vs_single, pack_size
 */

import { randomUUID } from 'crypto';
import type { Prisma, StockStatus } from '@prisma/client';
import type { EnrichedCatalogRow } from './enrichedTypes';

export type MappedProduct = {
  product: Prisma.ProductUncheckedCreateInput;
};

// Normalization helpers

const parseCommaList = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};

const parseBoolean = (value?: string | null): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  const normalized = value.toLowerCase().trim();
  const trueValues = ['true', 'yes', 'y', '1', 't', 'on', 'lined', 'humidity friendly', 'humidity_friendly', 'multicolor', 'has pockets'];
  const falseValues = ['false', 'no', 'n', '0', 'f', 'off', 'unlined', 'solid', 'no pockets'];
  if (trueValues.includes(normalized)) return true;
  if (falseValues.includes(normalized)) return false;
  return undefined;
};

const parsePriceToCents = (price?: string | null): { cents: number; currency: string } | null => {
  if (!price) return null;
  const normalized = price.replace(/,/g, '').trim();
  const numberMatch = normalized.match(/(\d+(\.\d+)?)/);
  if (!numberMatch) return null;
  const amount = Number.parseFloat(numberMatch[1]);
  if (Number.isNaN(amount)) return null;
  const currencyMatch = normalized.match(/([A-Za-z]{3})/);
  const currency = currencyMatch ? currencyMatch[1].toUpperCase() : 'USD';
  return { cents: Math.round(amount * 100), currency };
};

const normalizeStockStatus = (availability?: string | null): StockStatus => {
  if (!availability) return 'in_stock';
  const normalized = availability.toLowerCase();
  if (normalized.includes('out')) return 'out_of_stock';
  if (normalized.includes('preorder') || normalized.includes('pre-order')) return 'out_of_stock';
  if (normalized.includes('low')) return 'low_stock';
  return 'in_stock';
};

const normalizeString = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

/**
 * Normalize formality level values to consistent format
 */
const normalizeFormalityLevel = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  // Map common variations to canonical values
  if (lower.includes('casual')) return 'Casual';
  if (lower.includes('semi') || lower.includes('semi-formal')) return 'Semi-Formal';
  if (lower.includes('formal') || lower.includes('black tie')) return 'Formal';
  return normalized; // Return as-is if no match
};

/**
 * Normalize temperature intent values
 */
const normalizeTemperatureIntent = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (lower.includes('warm') || lower.includes('hot') || lower.includes('summer')) return 'Warm Weather';
  if (lower.includes('cool') || lower.includes('cold') || lower.includes('winter')) return 'Cool Weather';
  return normalized;
};

/**
 * Normalize color shade values
 */
const normalizeColorShade = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (lower.includes('light') || lower.includes('pale') || lower.includes('pastel')) return 'Light';
  if (lower.includes('medium') || lower.includes('mid')) return 'Medium';
  if (lower.includes('dark') || lower.includes('deep') || lower.includes('rich')) return 'Dark';
  return normalized;
};

/**
 * Normalize color undertone values
 */
const normalizeColorUndertone = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (lower.includes('warm')) return 'Warm';
  if (lower.includes('cool')) return 'Cool';
  if (lower.includes('neutral')) return 'Neutral';
  return normalized;
};

const lastSegment = (path?: string | null): string | undefined => {
  if (!path) return undefined;
  const segments = path.split('>').map((s) => s.trim()).filter(Boolean);
  return segments[segments.length - 1];
};

/**
 * Correct miscategorized products based on subcategory or title
 * Returns corrected category/subcategory if a miscategorization is detected
 */
function correctCategoryMiscategorization(
  category: string,
  subcategory: string | null,
  title?: string
): { category: string; subcategory: string | null } {
  const titleLower = (title || '').toLowerCase();
  const categoryLower = category.toLowerCase();
  const subcategoryLower = (subcategory || '').toLowerCase();
  
  // Laptop/Phone Cases should be in "Phone Cases" or "Accessories", not "Tops"
  if (categoryLower === 'tops' && (subcategoryLower.includes('laptop case') || subcategoryLower.includes('phone case'))) {
    return { category: 'Phone Cases', subcategory: null };
  }
  
  // If title contains "laptop case" or "phone case" but category is wrong, fix it
  if ((titleLower.includes('laptop case') || titleLower.includes('phone case')) && 
      categoryLower !== 'phone cases' && categoryLower !== 'accessories') {
    return { category: 'Phone Cases', subcategory: null };
  }
  
  // Tote bags, backpacks, etc. should be in "Accessories" or "Tote Bags", not apparel categories
  if ((subcategoryLower.includes('tote bag') || subcategoryLower.includes('backpack') || 
       subcategoryLower.includes('duffle') || subcategoryLower.includes('fanny pack')) &&
      (categoryLower === 'tops' || categoryLower === 'bottoms')) {
    return { category: 'Accessories', subcategory: subcategory };
  }
  
  // Dog beds should be in "Pets", not apparel
  if ((subcategoryLower.includes('dog bed') || titleLower.includes('dog bed')) &&
      categoryLower !== 'pets') {
    return { category: 'Pets', subcategory: subcategory };
  }
  
  // Jewelry should be in "Jewelry" or "Accessories", not apparel
  if ((subcategoryLower.includes('jewelry') || subcategoryLower.includes('earring') || 
       subcategoryLower.includes('necklace') || subcategoryLower.includes('bracelet')) &&
      (categoryLower === 'tops' || categoryLower === 'bottoms')) {
    return { category: 'Jewelry', subcategory: null };
  }
  
  // Soap dispensers should be in "Accessories", not apparel
  if ((subcategoryLower.includes('soap dispenser') || titleLower.includes('soap dispenser')) &&
      categoryLower !== 'accessories') {
    return { category: 'Soap Dispensers', subcategory: null };
  }
  
  return { category, subcategory };
}

/**
 * Parse product_type to extract category and subcategory
 * Format: "Apparel > Women's Dresses > Mini Dresses"
 * - 1 level: category = segment, subcategory = null
 * - 2 levels: category = first, subcategory = second
 * - 3+ levels: category = second-to-last, subcategory = last
 */
function parseProductType(productType: string | null, title?: string): { category: string; subcategory: string | null } {
  if (!productType) return { category: 'Uncategorized', subcategory: null };
  
  const segments = productType.split('>').map(s => s.trim()).filter(Boolean);
  
  let category: string;
  let subcategory: string | null;
  
  if (segments.length === 1) {
    category = segments[0];
    subcategory = null;
  } else if (segments.length === 2) {
    category = segments[0];
    subcategory = segments[1];
  } else {
    // 3+ levels: category is second-to-last, subcategory is last
    category = segments[segments.length - 2];
    subcategory = segments[segments.length - 1];
  }
  
  // Apply corrections for known miscategorizations
  return correctCategoryMiscategorization(category, subcategory, title);
}

const safeParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/**
 * Select the canonical product from a group of rows (same item_group_id)
 * Prefers row with longest description, falls back to first row
 */
function selectCanonicalProduct(rows: EnrichedCatalogRow[]): EnrichedCatalogRow {
  let best = rows[0];
  for (const row of rows) {
    if ((row.description_clean?.length || 0) > (best.description_clean?.length || 0)) {
      best = row;
    }
  }
  return best;
}

/**
 * Build attributes JSON object for fields not mapped to indexed columns
 */
function buildAttributes(row: EnrichedCatalogRow): Prisma.InputJsonValue {
  const attributes: Record<string, unknown> = {};
  const assign = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    attributes[key] = value;
  };

  assign('sizing_notes', row.sizing_notes);
  assign('care_requirements', row.care_requirements);
  assign('style_labels', parseCommaList(row.style_labels));
  assign('vibe_mood', parseCommaList(row.vibe_mood));
  assign('pattern_print', parseCommaList(row.pattern_print));
  assign('detailing', parseCommaList(row.detailing));
  assign('finish', row.finish);
  assign('modesty_cues', parseCommaList(row.modesty_cues));
  assign('rain_wind', row.rain_wind);
  assign('travel_features', parseCommaList(row.travel_features));
  assign('layering_intent', row.layering_intent);
  assign('pairing_intent', row.pairing_intent);
  assign('pockets', row.pockets);
  assign('lining_type', row.lining_type);
  assign('bra_solution', row.bra_solution);
  assign('slit', row.slit);
  assign('neckline_depth', row.neckline_depth);
  assign('waist_structure', row.waist_structure);
  assign('hem_style', row.hem_style);
  assign('collar_type', row.collar_type);
  assign('price_band', row.price_band);
  assign('deal_intent', row.deal_intent);
  assign('value_framing', row.value_framing);
  assign('eco_materials', parseCommaList(row.eco_materials));
  assign('certifications', row.certifications);
  assign('origin', row.origin);
  assign('durability_notes', row.durability_notes);
  assign('adaptive_features', row.adaptive_features);
  assign('sensory_friendly', row.sensory_friendly);
  assign('social_proof', row.social_proof);
  assign('llm_confidence_overall', row.llm_confidence_overall ? Number(row.llm_confidence_overall) : undefined);
  assign('llm_evidence_json', row.llm_evidence_json ? safeParseJson(row.llm_evidence_json) : undefined);
  assign('set_vs_single', row.set_vs_single);
  assign('pack_size', row.pack_size);
  assign('additional_image_links', parseCommaList(row.additional_image_links));

  // Variant-level information: keep sizes/colors in attributes for filtering
  const variantSizes = parseCommaList(row.variant_sizes);
  const variantColors = parseCommaList(row.variant_colors);
  assign('variant_sizes', variantSizes.length ? variantSizes : undefined);
  assign('variant_colors', variantColors.length ? variantColors : undefined);
  // Backwards-compatible sizes array for attribute-based size filtering
  assign('sizes', variantSizes.length ? variantSizes : undefined);
  
  // Store enriched_color and age_group in attributes as fallback
  assign('enriched_color', row.enriched_color);
  assign('age_group', row.age_group);

  return attributes as Prisma.InputJsonValue;
}

/**
 * Map enriched CSV rows to Product model
 * 
 * Groups rows by item_group_id, selects canonical product, and maps all
 * enriched attributes to indexed Product columns. Variant sizes and colors
 * are stored in Product.attributes as arrays for efficient filtering.
 * 
 * @param rows - Array of enriched CSV rows with same item_group_id
 * @param merchantId - Merchant ID
 * @param vendorId - Vendor ID
 * @param batchId - Ingestion batch ID
 * @returns Mapped Product object with enriched columns populated
 */
export function mapEnrichedToProduct(
  rows: EnrichedCatalogRow[],
  merchantId: string,
  vendorId: string,
  batchId: string,
): MappedProduct {
  const canonical = selectCanonicalProduct(rows);
  const productId = canonical.item_group_id || canonical.id;

  const price = parsePriceToCents(canonical.price);
  const salePrice = parsePriceToCents(canonical.sale_price);
  const stockStatus = normalizeStockStatus(canonical.availability);

  // Parse product_type to extract category and subcategory
  // Prefer product_type, fallback to taxonomy_path, then google_product_category
  // BUT: Apply corrections for known miscategorizations (e.g., "Laptop Case" under "Tops")
  let category: string;
  let subcategory: string | null;
  
  if (canonical.product_type) {
    const parsed = parseProductType(canonical.product_type, canonical.title_clean);
    category = parsed.category;
    subcategory = parsed.subcategory;
  } else if (canonical.taxonomy_path) {
    const parsed = parseProductType(canonical.taxonomy_path, canonical.title_clean);
    category = parsed.category;
    subcategory = parsed.subcategory;
  } else if (canonical.google_product_category) {
    // google_product_category is often more accurate (e.g., "Electronics > Computer Accessories")
    // Use it as-is if product_type/taxonomy_path are missing, but still apply corrections
    const parsed = parseProductType(canonical.google_product_category, canonical.title_clean);
    category = parsed.category;
    subcategory = parsed.subcategory;
  } else {
    category = 'Uncategorized';
    subcategory = null;
  }
  
  // Final correction pass: If we have a laptop/phone case but category is still wrong, use google_product_category as fallback
  const titleLower = (canonical.title_clean || '').toLowerCase();
  if ((titleLower.includes('laptop case') || titleLower.includes('phone case')) && 
      category.toLowerCase() !== 'phone cases' && 
      category.toLowerCase() !== 'accessories' &&
      canonical.google_product_category) {
    // Try to extract from google_product_category which is more accurate
    const googleParsed = parseProductType(canonical.google_product_category, canonical.title_clean);
    if (googleParsed.category.toLowerCase().includes('accessories') || 
        googleParsed.category.toLowerCase().includes('electronics')) {
      category = 'Phone Cases';
      subcategory = null;
    }
  }

  const occasionContext = parseCommaList(canonical.occasion_context);
  const problemSolutions = parseCommaList(canonical.problem_solutions);
  const functionFeatures = parseCommaList(canonical.function_features);

  const product: Prisma.ProductUncheckedCreateInput = {
    id: productId,
    merchantId,
    title: canonical.title_clean,
    description: canonical.description_clean || canonical.title_clean,
    imageUrl: canonical.image_link,
    productUrl: canonical.link_base,
    priceCents: price?.cents ?? 0,
    salePriceCents: salePrice?.cents ?? undefined,
    currency: price?.currency ?? salePrice?.currency ?? 'USD',
    category,
    subcategory,
    brand: canonical.brand || undefined,
    color: canonical.color || undefined,
    fabric: canonical.fabric_family || undefined,
    material: canonical.material || undefined,
    occasion: canonical.occasion_context || undefined,
    season: canonical.seasonal_cues || undefined,
    fit: canonical.fit_preference || undefined,
    
    // Enriched indexed columns
    silhouetteCut: normalizeString(canonical.silhouette_cut),
    length: normalizeString(canonical.length),
    sleeve: normalizeString(canonical.sleeve),
    neckline: normalizeString(canonical.neckline),
    closureConstruction: normalizeString(canonical.closure_construction),
    lined: parseBoolean(canonical.lined),
    fitPreference: normalizeString(canonical.fit_preference),
    riseWaist: normalizeString(canonical.rise_waist),
    stretchLevel: normalizeString(canonical.stretch_level),
    bodyIntent: normalizeString(canonical.body_intent),
    comfortIntent: normalizeString(canonical.comfort_intent),
    fabricFamily: normalizeString(canonical.fabric_family),
    handfeel: normalizeString(canonical.handfeel),
    warmthWeight: normalizeString(canonical.warmth_weight),
    breathability: normalizeString(canonical.breathability),
    opacity: normalizeString(canonical.opacity),
    wrinkleBehavior: normalizeString(canonical.wrinkle_behavior),
    formalityLevel: normalizeFormalityLevel(canonical.formality_level),
    occasionContext,
    dressCode: normalizeString(canonical.dress_code),
    seasonalCues: normalizeString(canonical.seasonal_cues),
    temperatureIntent: normalizeTemperatureIntent(canonical.temperature_intent),
    humidityFriendly: parseBoolean(canonical.humidity_friendly),
    movementNeeds: normalizeString(canonical.movement_needs),
    problemSolutions,
    functionFeatures,
    colorShade: normalizeColorShade(canonical.color_shade),
    colorUndertone: normalizeColorUndertone(canonical.color_undertone),
    multicolor: parseBoolean(canonical.multicolor),
    seasonalPalette: normalizeString(canonical.seasonal_palette),
    inclusivitySizing: normalizeString(canonical.inclusivity_sizing),
    enrichedColor: normalizeString(canonical.enriched_color),
    ageGroup: normalizeString(canonical.age_group),
    
    attributes: buildAttributes(canonical),
    stockStatus,
    vendorId,
    sourceId: canonical.item_group_id || canonical.id,
    isActive: true,
    lastIngestBatchId: batchId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return { product };
}
