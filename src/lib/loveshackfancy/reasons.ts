/**
 * Product Reason Builder
 * 
 * Generates "Chosen because..." reasons for product cards.
 */

import type { SearchResultItem } from '../search/types';

type ReasonContext = {
  style?: string;
  occasion?: string;
  collection?: string;
  pattern?: string;
  material?: string;
  length?: string;
  embellishment?: string;
};

/**
 * Build a "Chosen because..." reason for a product card
 */
export function buildProductReason(
  product: SearchResultItem,
  query: string,
  context: ReasonContext
): string {
  const attrs = product.attributes || {};
  const reasons: string[] = [];

  // Extract relevant attributes
  const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style');
  const occasion = extractAttr(attrs, 'Occasion') || extractAttr(attrs, 'occasion');
  const pattern = extractAttr(attrs, 'Pattern') || extractAttr(attrs, 'pattern');
  const material = extractAttr(attrs, 'Material') || extractAttr(attrs, 'material');
  const length = extractAttr(attrs, 'Length') || extractAttr(attrs, 'length');
  const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color');

  // Build reason based on context and product attributes
  if (context.style && style && style.toLowerCase().includes(context.style.toLowerCase())) {
    reasons.push(`matches your ${context.style} style preference`);
  }
  if (context.occasion && occasion && occasion.toLowerCase().includes(context.occasion.toLowerCase())) {
    reasons.push(`perfect for ${context.occasion}`);
  }
  if (context.pattern && pattern && pattern.toLowerCase().includes(context.pattern.toLowerCase())) {
    reasons.push(`features a ${context.pattern} pattern`);
  }
  if (context.material && material && material.toLowerCase().includes(context.material.toLowerCase())) {
    reasons.push(`made from ${context.material}`);
  }
  if (context.length && length && length.toLowerCase().includes(context.length.toLowerCase())) {
    reasons.push(`comes in a ${context.length} length`);
  }
  if (color) {
    reasons.push(`available in ${color}`);
  }

  // Fallback reasons
  if (reasons.length === 0) {
    if (style) {
      reasons.push(`features a ${style} style`);
    } else if (occasion) {
      reasons.push(`suitable for ${occasion}`);
    } else {
      reasons.push('matches your search criteria');
    }
  }

  return `Chosen because ${reasons.slice(0, 2).join(' and ')}.`;
}

function extractAttr(attrs: Record<string, unknown>, key: string): string | null {
  const val = attrs[key];
  if (Array.isArray(val) && val.length > 0) {
    return String(val[0]);
  }
  if (typeof val === 'string' && val) {
    return val;
  }
  return null;
}
