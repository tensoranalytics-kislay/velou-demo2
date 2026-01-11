/**
 * Search Utilities
 * 
 * Shared utility functions used across search modules
 */

import type { ProductAttributes } from './types';
import type { SearchResultItem } from './types';

/**
 * Extract searchable text from product attributes (for text search)
 * 
 * Includes product_highlights, bullet_highlights, and product_details values.
 * Used for building searchable text from product JSON attributes.
 * 
 * @param attributes - Product attributes
 * @returns Concatenated searchable text
 */
export function extractSearchableTextFromAttributes(attributes: ProductAttributes): string {
  const parts: string[] = [];
  
  // product_highlights (string)
  if (attributes.productHighlights) {
    parts.push(attributes.productHighlights);
  }
  
  // bullet_highlights (array)
  if (attributes.bulletHighlights && Array.isArray(attributes.bulletHighlights)) {
    parts.push(...attributes.bulletHighlights);
  }
  
  // product_details (object) - extract values
  const productDetails = attributes.product_details as Record<string, string> | undefined;
  if (productDetails && typeof productDetails === 'object') {
    parts.push(...Object.values(productDetails));
  }

  // Need/benefit/attribute signals
  if (attributes.benefits) parts.push(...attributes.benefits);
  if (attributes.claims) parts.push(...attributes.claims);
  if (attributes.useCases) parts.push(...attributes.useCases);
  if (attributes.styleTags) parts.push(...attributes.styleTags);
  if (attributes.compatibility) parts.push(...attributes.compatibility);
  if (attributes.sensoryProfile) parts.push(attributes.sensoryProfile);
  if ((attributes as any).attribute_chips) {
    const chips = (attributes as any).attribute_chips;
    if (Array.isArray(chips)) parts.push(...chips);
  }

  // Identity/family hints
  if (attributes.label) parts.push(attributes.label);
  if (attributes.collection) parts.push(attributes.collection);
  if (attributes.brand) parts.push(attributes.brand);

  // Specs / ingredients / materials
  if (attributes.ingredients) parts.push(...attributes.ingredients);
  if (attributes.materials) parts.push(...attributes.materials);
  if ((attributes as any).material) parts.push((attributes as any).material as string);
  if (attributes.dimensions) parts.push(attributes.dimensions);
  if (attributes.weight) parts.push(attributes.weight);
  if (attributes.sizeFitNotes) parts.push(attributes.sizeFitNotes);
  if (attributes.usageInstructions) parts.push(attributes.usageInstructions);
  if (attributes.safetyCompliance) parts.push(...attributes.safetyCompliance);
  
  // L'Occitane structured attributes (for enhanced searchability)
  if (attributes.loccitaneStructured) {
    const structured = attributes.loccitaneStructured;
    // Add canonical concerns (normalized for better matching)
    if (structured.canonicalConcerns.length > 0) {
      parts.push(...structured.canonicalConcerns);
    }
    // Add canonical ingredients (normalized for better matching)
    if (structured.canonicalIngredients.length > 0) {
      parts.push(...structured.canonicalIngredients);
    }
    // Add skin types, application areas, made without
    if (structured.skinTypes.length > 0) parts.push(...structured.skinTypes);
    if (structured.hairTypes.length > 0) parts.push(...structured.hairTypes);
    if (structured.applicationAreas.length > 0) parts.push(...structured.applicationAreas);
    if (structured.madeWithout.length > 0) parts.push(...structured.madeWithout);
    // Add product type and formula
    if (structured.productType) parts.push(structured.productType);
    if (structured.formula) parts.push(structured.formula);
  }
  
  return parts.filter(Boolean).join(' ');
}

/**
 * Build indexed text for embedding generation
 * 
 * Creates a consistent text representation of a product that includes
 * all searchable fields. Used for both:
 * - Generating product embeddings during ingestion
 * - Generating query embeddings for semantic search
 * 
 * For products, this combines:
 * - Title, description, category, subcategory
 * - Structured attributes (concerns, ingredients, skin types, etc.)
 * - Product highlights and bullet points
 * 
 * For queries, this is typically just the query text, but the same
 * function signature allows for future query enhancement.
 * 
 * @param product - Product to build indexed text from (or null for query text)
 * @param queryText - Query text (used when product is null or for query embeddings)
 * @returns Indexed text string for embedding generation
 */
export function buildIndexedText(
  product: SearchResultItem | null,
  queryText?: string
): string {
  if (product) {
    // Build indexed text from product
    const parts: string[] = [];
    
    // Core product fields
    if (product.title) parts.push(product.title);
    if (product.description) parts.push(product.description);
    if (product.category) parts.push(product.category);
    if (product.subcategory) parts.push(product.subcategory);
    
    // Enriched color (highest priority for color matching)
    if (product.enrichedColor) parts.push(product.enrichedColor);
    
    // Enriched attributes from columns (for semantic search)
    if (product.formalityLevel) parts.push(`formality: ${product.formalityLevel}`);
    if (product.temperatureIntent) parts.push(`temperature: ${product.temperatureIntent}`);
    if (product.occasionContext?.length) parts.push(`occasion: ${product.occasionContext.join(', ')}`);
    if (product.problemSolutions?.length) parts.push(`features: ${product.problemSolutions.join(', ')}`);
    if (product.functionFeatures?.length) parts.push(`functions: ${product.functionFeatures.join(', ')}`);
    if (product.seasonalPalette) parts.push(`season: ${product.seasonalPalette}`);
    if (product.length) parts.push(`length: ${product.length}`);
    
    // Additional enriched columns from product
    if ((product as any).silhouetteCut) parts.push(`silhouette: ${(product as any).silhouetteCut}`);
    if ((product as any).sleeve) parts.push(`sleeve: ${(product as any).sleeve}`);
    if ((product as any).neckline) parts.push(`neckline: ${(product as any).neckline}`);
    if ((product as any).closureConstruction) parts.push(`closure: ${(product as any).closureConstruction}`);
    if ((product as any).fitPreference) parts.push(`fit: ${(product as any).fitPreference}`);
    if ((product as any).riseWaist) parts.push(`rise: ${(product as any).riseWaist}`);
    if ((product as any).stretchLevel) parts.push(`stretch: ${(product as any).stretchLevel}`);
    if ((product as any).bodyIntent) parts.push(`body: ${(product as any).bodyIntent}`);
    if ((product as any).comfortIntent) parts.push(`comfort: ${(product as any).comfortIntent}`);
    if ((product as any).fabricFamily) parts.push(`fabric: ${(product as any).fabricFamily}`);
    if ((product as any).handfeel) parts.push(`handfeel: ${(product as any).handfeel}`);
    if ((product as any).warmthWeight) parts.push(`warmth: ${(product as any).warmthWeight}`);
    if ((product as any).breathability) parts.push(`breathability: ${(product as any).breathability}`);
    if ((product as any).opacity) parts.push(`opacity: ${(product as any).opacity}`);
    if ((product as any).wrinkleBehavior) parts.push(`wrinkle: ${(product as any).wrinkleBehavior}`);
    if ((product as any).dressCode) parts.push(`dresscode: ${(product as any).dressCode}`);
    if ((product as any).seasonalCues) parts.push(`seasonal: ${(product as any).seasonalCues}`);
    if ((product as any).movementNeeds) parts.push(`movement: ${(product as any).movementNeeds}`);
    if ((product as any).inclusivitySizing) parts.push(`sizing: ${(product as any).inclusivitySizing}`);
    
    // Searchable attributes from JSON (fallback)
    const attrs = product.attributes;
    const searchableText = extractSearchableTextFromAttributes(attrs);
    if (searchableText) {
      parts.push(searchableText);
    }
    
    // Style and mood from attributes
    if ((attrs as any).style_labels) {
      const styleLabels = (attrs as any).style_labels;
      if (Array.isArray(styleLabels)) {
        parts.push(...styleLabels);
      }
    }
    if ((attrs as any).vibe_mood) {
      const vibeMood = (attrs as any).vibe_mood;
      if (Array.isArray(vibeMood)) {
        parts.push(...vibeMood);
      }
    }
    if ((attrs as any).pattern_print) {
      const patternPrint = (attrs as any).pattern_print;
      if (Array.isArray(patternPrint)) {
        parts.push(...patternPrint);
      }
    }
    if ((attrs as any).detailing) {
      const detailing = (attrs as any).detailing;
      if (Array.isArray(detailing)) {
        parts.push(...detailing);
      } else if (typeof detailing === 'string') {
        parts.push(detailing);
      }
    }
    
    // Fabric and material
    if ((attrs as any).fabric_family) parts.push(`fabric: ${(attrs as any).fabric_family}`);
    if (attrs.material) parts.push(`material: ${attrs.material}`);
    
    // Care and sizing
    if ((attrs as any).care_requirements) {
      const care = (attrs as any).care_requirements;
      if (Array.isArray(care)) {
        parts.push(...care);
      } else if (typeof care === 'string') {
        parts.push(care);
      }
    }
    if ((attrs as any).sizing_notes) parts.push(`sizing: ${(attrs as any).sizing_notes}`);
    
    // Finish and construction details
    if ((attrs as any).finish) parts.push(`finish: ${(attrs as any).finish}`);
    if ((attrs as any).modesty_cues) {
      const modesty = (attrs as any).modesty_cues;
      if (Array.isArray(modesty)) {
        parts.push(...modesty);
      } else if (typeof modesty === 'string') {
        parts.push(modesty);
      }
    }
    
    // Weather and travel
    if ((attrs as any).rain_wind) parts.push(`weather: ${(attrs as any).rain_wind}`);
    if ((attrs as any).travel_features) {
      const travel = (attrs as any).travel_features;
      if (Array.isArray(travel)) {
        parts.push(...travel);
      } else if (typeof travel === 'string') {
        parts.push(travel);
      }
    }
    
    // Construction details
    if ((attrs as any).layering_intent) parts.push(`layering: ${(attrs as any).layering_intent}`);
    if ((attrs as any).pairing_intent) parts.push(`pairing: ${(attrs as any).pairing_intent}`);
    if ((attrs as any).pockets) parts.push(`pockets: ${(attrs as any).pockets}`);
    if ((attrs as any).lining_type) parts.push(`lining: ${(attrs as any).lining_type}`);
    if ((attrs as any).bra_solution) parts.push(`bra: ${(attrs as any).bra_solution}`);
    if ((attrs as any).slit) parts.push(`slit: ${(attrs as any).slit}`);
    if ((attrs as any).neckline_depth) parts.push(`neckline_depth: ${(attrs as any).neckline_depth}`);
    if ((attrs as any).waist_structure) parts.push(`waist: ${(attrs as any).waist_structure}`);
    if ((attrs as any).hem_style) parts.push(`hem: ${(attrs as any).hem_style}`);
    if ((attrs as any).collar_type) parts.push(`collar: ${(attrs as any).collar_type}`);
    
    // Commercial and value
    if ((attrs as any).price_band) parts.push(`price_band: ${(attrs as any).price_band}`);
    if ((attrs as any).deal_intent) parts.push(`deal: ${(attrs as any).deal_intent}`);
    if ((attrs as any).value_framing) parts.push(`value: ${(attrs as any).value_framing}`);
    
    // Sustainability and quality
    if ((attrs as any).eco_materials) {
      const eco = (attrs as any).eco_materials;
      if (Array.isArray(eco)) {
        parts.push(...eco);
      } else if (typeof eco === 'string') {
        parts.push(eco);
      }
    }
    if ((attrs as any).certifications) parts.push(`certified: ${(attrs as any).certifications}`);
    if ((attrs as any).origin) parts.push(`origin: ${(attrs as any).origin}`);
    if ((attrs as any).durability_notes) parts.push(`durability: ${(attrs as any).durability_notes}`);
    
    // Inclusivity
    if ((attrs as any).adaptive_features) parts.push(`adaptive: ${(attrs as any).adaptive_features}`);
    if ((attrs as any).sensory_friendly) parts.push(`sensory: ${(attrs as any).sensory_friendly}`);
    if ((attrs as any).social_proof) parts.push(`proof: ${(attrs as any).social_proof}`);
    
    // Product structure
    if ((attrs as any).set_vs_single) parts.push(`type: ${(attrs as any).set_vs_single}`);
    if ((attrs as any).pack_size) parts.push(`pack: ${(attrs as any).pack_size}`);
    
    // Age group
    if (product.ageGroup) parts.push(`age: ${product.ageGroup}`);
    
    return parts.filter(Boolean).join(' ');
  } else {
    // For queries, just return the query text
    return queryText || '';
  }
}
