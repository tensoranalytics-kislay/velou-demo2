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
    // Note: SearchResultItem doesn't have subcategory, but it might be in attributes
    const subcategory = (product.attributes as any)?.subcategory;
    if (subcategory) parts.push(subcategory);
    
    // Searchable attributes
    const attrs = product.attributes;
    const searchableText = extractSearchableTextFromAttributes(attrs);
    if (searchableText) {
      parts.push(searchableText);
    }
    
    return parts.join(' ');
  } else {
    // For queries, just return the query text
    return queryText || '';
  }
}
