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
 * Prioritizes enriched attributes (problemSolutions, functionFeatures, humidityFriendly) over generic attributes
 */
export function buildProductReason(
  product: SearchResultItem,
  query: string,
  context: ReasonContext
): string {
  const attrs = product.attributes || {};
  const reasons: string[] = [];

  // Prioritize enriched attributes: problemSolutions and functionFeatures
  // Check enriched columns first, then fallback to JSON attributes
  const problemSolutions = product.problemSolutions ?? (attrs.problemSolutions as string[] | undefined);
  const functionFeatures = product.functionFeatures ?? (attrs.functionFeatures as string[] | undefined);
  const humidityFriendly = product.humidityFriendly ?? (attrs.humidityFriendly as boolean | undefined);
  const temperatureIntent = product.temperatureIntent ?? (attrs.temperatureIntent as string | undefined);

  // Build reasons from enriched attributes (highest priority)
  if (problemSolutions && Array.isArray(problemSolutions) && problemSolutions.length > 0) {
    // Check for common problem solutions
    const problemSolutionMap: Record<string, string> = {
      'wrinkle-free': 'wrinkle-free',
      'wrinkle free': 'wrinkle-free',
      'pockets': 'has pockets',
      'bra-friendly': 'bra-friendly',
      'bra friendly': 'bra-friendly',
      'travel-friendly': 'travel-friendly',
      'travel friendly': 'travel-friendly',
      'flattering': 'flattering',
      'comfortable': 'comfortable',
      'stain-resistant': 'stain-resistant',
      'stain resistant': 'stain-resistant',
    };
    
    for (const solution of problemSolutions) {
      const normalizedSolution = solution.toLowerCase().trim();
      const reasonText = problemSolutionMap[normalizedSolution] || normalizedSolution.replace(/-/g, ' ');
      if (!reasons.some(r => r.includes(reasonText))) {
        reasons.push(reasonText);
      }
    }
  }

  if (functionFeatures && Array.isArray(functionFeatures) && functionFeatures.length > 0) {
    // Check for common function features
    const functionFeatureMap: Record<string, string> = {
      'pockets': 'has pockets',
      'adjustable': 'adjustable',
      'removable': 'removable',
      'convertible': 'convertible',
      'reversible': 'reversible',
    };
    
    for (const feature of functionFeatures) {
      const normalizedFeature = feature.toLowerCase().trim();
      const reasonText = functionFeatureMap[normalizedFeature] || normalizedFeature.replace(/-/g, ' ');
      if (!reasons.some(r => r.includes(reasonText))) {
        reasons.push(reasonText);
      }
    }
  }

  if (humidityFriendly === true) {
    reasons.push('humidity-friendly');
  }

  if (temperatureIntent) {
    const queryLower = query.toLowerCase();
    if ((temperatureIntent.toLowerCase().includes('warm') && (queryLower.includes('hot') || queryLower.includes('summer') || queryLower.includes('warm'))) ||
        (temperatureIntent.toLowerCase().includes('cool') && (queryLower.includes('cold') || queryLower.includes('winter') || queryLower.includes('cool')))) {
      reasons.push(`perfect for ${temperatureIntent.toLowerCase()}`);
    }
  }

  // Extract relevant attributes (fallback to JSON if enriched not available)
  const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style');
  const occasion = extractAttr(attrs, 'Occasion') || extractAttr(attrs, 'occasion');
  const pattern = extractAttr(attrs, 'Pattern') || extractAttr(attrs, 'pattern');
  const material = extractAttr(attrs, 'Material') || extractAttr(attrs, 'material');
  const length = product.length ?? extractAttr(attrs, 'Length') ?? extractAttr(attrs, 'length');
  const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color');

  // Build reason based on context and product attributes (only if we don't have enriched reasons yet)
  if (reasons.length === 0) {
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
