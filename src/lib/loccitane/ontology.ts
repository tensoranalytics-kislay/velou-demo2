/**
 * L'Occitane-Specific Ontology
 * 
 * Pre-computed knowledge base for L'Occitane products.
 * This eliminates the need for dynamic DB queries and speeds up intent extraction.
 */

export const LOCCITANE_ONTOLOGY = {
  // Product Collections (major product lines)
  collections: [
    'Shea',
    'Almond',
    'Immortelle Divine',
    'Verbena',
    'Cherry Blossom',
    'Lavande Poivre Noir',
    'L\'OCCITAN',
    'Peony',
    'Rosemary',
    'Néroli Orchidée',
    'Lumière d\'Hiver',
    'Mélilot',
    'Noble Épine',
  ],

  // Product Types/Categories (what customers ask for)
  productTypes: [
    'Hand Cream',
    'Body Lotion',
    'Shower Oil',
    'Shower Gel',
    'Body Scrub',
    'Face Serum',
    'Face Cleanser',
    'Face Moisturizer',
    'Eye Cream',
    'Lip Balm',
    'Shampoo',
    'Conditioner',
    'Hair Treatment',
    'Scalp Treatment',
    'Perfume',
    'Eau de Parfum',
    'Eau de Toilette',
    'Soap',
    'Body Wash',
    'Gift Set',
    'Duo',
    'Trio',
  ],

  // Skin/Hair Concerns (what customers want to address)
  concerns: [
    'dryness',
    'aging',
    'fine lines',
    'wrinkles',
    'dullness',
    'hydration',
    'radiance',
    'rough texture',
    'sensitive skin',
    'scalp discomfort',
    'frizz',
    'hair breakage',
    'hair thinning',
    'dandruff',
    'acne',
    'redness',
    'dehydration',
  ],

  // Key Ingredients (what makes products special)
  ingredients: [
    'shea butter',
    'immortelle',
    'almond oil',
    'sweet almond oil',
    'verbena',
    'lavender',
    'cherry blossom',
    'peony',
    'rosemary',
    'neroli',
    'orchid',
    'rose',
    'vanilla',
    'cedar',
    'bergamot',
    'hyaluronic acid',
    'retinol',
    'glycerin',
    'vitamin e',
    'vitamin b5',
    'panthenol',
    'niacinamide',
    'ginkgo biloba',
  ],

  // Benefits (what products do)
  benefits: [
    'hydrates',
    'moisturizes',
    'softens',
    'nourishes',
    'brightens',
    'rejuvenates',
    'anti-aging',
    'reduces fine lines',
    'improves radiance',
    'soothes',
    'cleanses',
    'exfoliates',
    'repairs',
    'strengthens',
    'volumizes',
    'reduces frizz',
    'controls dandruff',
  ],

  // Gender categories (most L'Occitane is unisex, some are targeted)
  genders: ['unisex', 'women', 'men'] as const,

  // Price ranges (typical L'Occitane pricing)
  priceRanges: {
    budget: { max: 30 }, // Under $30
    mid: { min: 30, max: 75 }, // $30-$75
    premium: { min: 75, max: 150 }, // $75-$150
    luxury: { min: 150 }, // $150+
  },
} as const;

/**
 * Collection synonyms - map user language to collection names
 */
export const COLLECTION_SYNONYMS: Record<string, string[]> = {
  'shea': ['shea', 'shea butter'],
  'almond': ['almond', 'sweet almond'],
  'immortelle divine': ['immortelle', 'immortelle divine', 'anti-aging', 'youth'],
  'verbena': ['verbena', 'citrus verbena'],
  'cherry blossom': ['cherry blossom', 'fleurs de cerisier'],
  'lavande poivre noir': ['lavande', 'lavender', 'loccitan', 'poivre noir'],
  'peony': ['peony', 'peonie'],
  'rosemary': ['rosemary', 'romarin'],
  'neroli orchidée': ['neroli', 'orchid', 'orchidée'],
};

/**
 * Product type synonyms - map user language to product types
 */
export const PRODUCT_TYPE_SYNONYMS: Record<string, string[]> = {
  'hand cream': ['hand cream', 'hand lotion', 'hand moisturizer', 'cream for hands'],
  'body lotion': ['body lotion', 'body moisturizer', 'body cream', 'lotion'],
  'shower oil': ['shower oil', 'bath oil', 'shower'],
  'shower gel': ['shower gel', 'body wash', 'gel'],
  'face serum': ['face serum', 'serum', 'face treatment'],
  'face cleanser': ['face cleanser', 'cleanser', 'cleansing balm', 'face wash'],
  'face moisturizer': ['face moisturizer', 'face cream', 'moisturizer'],
  'lip balm': ['lip balm', 'lip care', 'chapstick'],
  'shampoo': ['shampoo', 'shampoo'],
  'gift set': ['gift set', 'gift', 'set', 'duo', 'trio', 'bundle'],
};

/**
 * Concern synonyms - map user language to concerns
 */
export const CONCERN_SYNONYMS: Record<string, string[]> = {
  'dryness': ['dry', 'dryness', 'dry skin', 'dehydrated', 'moisture'],
  'aging': ['aging', 'age', 'anti-aging', 'wrinkles', 'fine lines', 'mature skin'],
  'dullness': ['dull', 'dullness', 'brightening', 'radiance', 'glow'],
  'sensitive skin': ['sensitive', 'sensitivity', 'irritated', 'calming'],
  'frizz': ['frizz', 'frizzy', 'unruly hair'],
  'hair breakage': ['breakage', 'damaged hair', 'repair'],
};

/**
 * Quick lookup: Check if a keyword matches any L'Occitane collection
 */
export function matchesCollection(keyword: string): string | null {
  const lower = keyword.toLowerCase();
  
  for (const [collection, synonyms] of Object.entries(COLLECTION_SYNONYMS)) {
    if (synonyms.some(syn => lower.includes(syn))) {
      return collection;
    }
  }
  
  // Direct match
  if (LOCCITANE_ONTOLOGY.collections.some(c => c.toLowerCase().includes(lower))) {
    return LOCCITANE_ONTOLOGY.collections.find(c => c.toLowerCase().includes(lower))!;
  }
  
  return null;
}

/**
 * Quick lookup: Check if a keyword matches any L'Occitane product type
 */
export function matchesProductType(keyword: string): string | null {
  const lower = keyword.toLowerCase();
  
  for (const [productType, synonyms] of Object.entries(PRODUCT_TYPE_SYNONYMS)) {
    if (synonyms.some(syn => lower.includes(syn))) {
      return productType;
    }
  }
  
  // Direct match
  if (LOCCITANE_ONTOLOGY.productTypes.some(pt => pt.toLowerCase().includes(lower))) {
    return LOCCITANE_ONTOLOGY.productTypes.find(pt => pt.toLowerCase().includes(lower))!;
  }
  
  return null;
}

/**
 * Quick lookup: Check if a keyword matches any concern
 */
export function matchesConcern(keyword: string): string | null {
  const lower = keyword.toLowerCase();
  
  for (const [concern, synonyms] of Object.entries(CONCERN_SYNONYMS)) {
    if (synonyms.some(syn => lower.includes(syn))) {
      return concern;
    }
  }
  
  // Direct match
  if (LOCCITANE_ONTOLOGY.concerns.some(c => c.toLowerCase().includes(lower))) {
    return LOCCITANE_ONTOLOGY.concerns.find(c => c.toLowerCase().includes(lower))!;
  }
  
  return null;
}

/**
 * Extract price from query
 */
export function extractPrice(query: string): { min?: number; max?: number } | null {
  const priceRegex = /\$(\d+)/gi;
  const underRegex = /under\s+\$(\d+)/i;
  const overRegex = /over\s+\$(\d+)/i;
  const rangeRegex = /\$(\d+)\s*[-–]\s*\$(\d+)/i;
  
  let match;
  
  // Price range: $50-$100
  match = rangeRegex.exec(query);
  if (match) {
    return { min: parseInt(match[1]), max: parseInt(match[2]) };
  }
  
  // Under $X
  match = underRegex.exec(query);
  if (match) {
    return { max: parseInt(match[1]) };
  }
  
  // Over $X
  match = overRegex.exec(query);
  if (match) {
    return { min: parseInt(match[1]) };
  }
  
  // Single price mentions
  const prices: number[] = [];
  while ((match = priceRegex.exec(query)) !== null) {
    prices.push(parseInt(match[1]));
  }
  
  if (prices.length === 1) {
    // Single price = maximum budget
    return { max: prices[0] };
  }
  
  if (prices.length > 1) {
    // Multiple prices = use max as upper bound
    return { max: Math.max(...prices) };
  }
  
  return null;
}



