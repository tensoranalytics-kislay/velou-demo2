export type PageType = 'HOME' | 'PLP' | 'PDP';

export type SearchConstraints = {
  query?: string;
  category?: string | string[]; // Support single category or multi-category (outfits)
  priceMinCents?: number;
  priceMaxCents?: number;
  colors?: string[];
  sizes?: string[];
  fabrics?: string[];
  fit?: string;
  seasons?: string[];
  occasions?: string[];
  lengths?: string[]; // Dress/skirt lengths (e.g., "Mini", "Midi", "Maxi")
  useCases?: string[]; // Generic: usage contexts (e.g., "travel", "office", "gift", "beginner-friendly", "night routine")
  styleTags?: string[]; // Generic: style descriptors (e.g., "minimalist", "bold", "sporty", "luxury")
  benefits?: string[]; // Generic: product benefits (e.g., "durable", "lightweight", "energy efficient", "high performance")
  claims?: string[]; // Generic: certifications/claims (e.g., "certified organic", "B Corp", "warranty included", "eco-friendly")
  sensoryProfile?: string; // Generic: experiential descriptors (e.g., "soft feel", "bright sound", "citrus scent", "matte look")
  compatibility?: string[]; // Generic: compatibility requirements (e.g., "works with iOS", "for small rooms", "for tall people", "for sensitive use cases")
  brands?: string[];
  genders?: string[];
  materials?: string[];
  productTypes?: string[];
  googleCategories?: string[];
  customLabels4?: string[];
  conditions?: string[];
  ageGroups?: string[];
  inStockOnly?: boolean;
  excludeProductIds?: string[];
  limit?: number;
  // V2: Expanded keywords from LLM for synonym-based recall
  expandedKeywords?: string[];
};

import type { StructuredLoccitaneAttributes } from '../loccitane/attributeParser';

/**
 * TODO: Enhanced attribute structure for multi-view retrieval
 * See: docs/loccitane_multiview_retrieval.md
 * 
 * Future: Add StructuredLoccitaneAttributes to support concept-based retrieval:
 * - concerns: string[]
 * - skinTypes: string[]
 * - applicationAreas: string[]
 * - canonicalIngredients: string[]
 * - etc.
 */
export type ProductAttributes = {
  // Apparel-specific (existing)
  fabric?: string;
  fit?: string;
  length?: string;
  pattern?: string;
  season?: string;
  occasion?: string;
  color?: string;
  sizes?: string[];
  care?: string;
  material?: string;
  productType?: string;
  googleProductCategory?: string;
  customLabel4?: string;
  condition?: string;
  ageGroup?: string;
  gender?: string;
  brand?: string;
  
  // Unified catalog fields (industry-agnostic)
  useCases?: string[]; // from usage_contexts
  styleTags?: string[]; // from style_tags
  benefits?: string[];
  claims?: string[];
  safetyCompliance?: string[];
  sensoryProfile?: string;
  compatibility?: string[];
  collection?: string;
  label?: string;
  shipRegions?: string[];
  bulletHighlights?: string[];
  productHighlights?: string;
  usageInstructions?: string;
  materials?: string[]; // Array version (from materials pipe_list if applicable)
  ingredients?: string[];
  dimensions?: string;
  weight?: string;
  sizeFitNotes?: string;
  
  // Extensible attributes from attribute_blob
  extensible?: Record<string, unknown>;
  
  // L'Occitane structured attributes (from parsed product_details)
  // Optional to maintain backward compatibility with non-L'Occitane products
  loccitaneStructured?: StructuredLoccitaneAttributes;
  
  // Additional fields that may exist
  [key: string]: unknown;
};

export type SearchResultItem = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  productUrl: string;
  priceCents: number;
  salePriceCents?: number | null;
  currency: string;
  category: string;
  stockStatus: string;
  attributes: ProductAttributes;
};

export type ProductSearchResult = {
  products: SearchResultItem[];
  wasRelaxed: boolean;
};

