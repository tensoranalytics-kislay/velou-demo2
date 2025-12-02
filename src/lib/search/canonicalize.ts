/**
 * Canonicalization and synonym mapping for product categories
 * Maps user language to canonical categories that match dataset taxonomy
 */

export type CanonicalCategory =
  | 'TSHIRT'
  | 'TOP'
  | 'SKIRT'
  | 'JEANS'
  | 'PANTS'
  | 'SHORTS'
  | 'DRESS'
  | 'SWEATER'
  | 'HOODIE'
  | 'JACKET'
  | 'SHOES'
  | 'ACCESSORY'
  | 'UNKNOWN';

type CanonicalGroup = {
  canonical: CanonicalCategory;
  synonyms: string[];
  // Expanded leaf categories that might appear in DB
  expandedLeafCats: string[];
  // Google Product Category parent terms
  parentGpcTerms: string[];
  // Product type synonyms
  productTypeSynonyms: string[];
};

export type CategoryProfile = {
  name: string;
  groups: Record<CanonicalCategory, CanonicalGroup>;
};

/**
 * Fashion-specific canonical category groups.
 * These are now part of an optional profile so generic catalogs
 * don't inherit apparel-only heuristics by default.
 */
const FASHION_CATEGORY_GROUPS: Record<CanonicalCategory, CanonicalGroup> = {
  TSHIRT: {
    canonical: 'TSHIRT',
    synonyms: [
      // Core variations - MUST include spaced "t shirt" for CSV matching
      't shirt', 't-shirt', 'tshirt', 't shirts', 't-shirts', 'tee', 'tees', 'tee shirt', 'tee shirts',
      // Graphic variations
      'graphic tee', 'graphic tees', 'graphic t-shirt', 'graphic tshirt', 'graphic t shirt',
      // Style variations
      'crewneck tee', 'crew tee', 'v-neck tee', 'v neck tee', 'pocket tee',
      'long sleeve tee', 'short sleeve tee',
      // Tank/cami variations
      'tank top', 'tank', 'tank tops', 'camisole', 'cami', 'camis',
      // Additional common terms
      'henley', 'henleys',
    ],
    expandedLeafCats: [
      't shirt', 'solid t shirts', // Removed 'graphic t shirt' from default - only include if user explicitly says "graphic"
      'short sleeve shirt', 'long sleeve shirt', 'sleeveless shirt',
      'crewneck tee', 'v-neck tee', 'pocket tee', 'tank top',
    ],
    parentGpcTerms: ['Shirts & Tops', 'Apparel & Accessories > Clothing > Shirts & Tops'],
    productTypeSynonyms: [
      't shirt', 'tshirt', 't-shirt', 'tee', 'graphic tee', 'tank', 'crewneck', 'v-neck',
      'pocket tee', 'henley', 'camisole',
    ],
  },
  TOP: {
    canonical: 'TOP',
    synonyms: [
      'top', 'tops', 'blouse', 'blouses', 'shirt', 'shirts',
      'button down', 'button-down', 'button up', 'oxford',
      'camisole', 'tank top', 'tank', 'sleeveless top',
    ],
    expandedLeafCats: ['shirt', 'woven tops', 'knit tops', 'blouse', 'shirts & tops'],
    parentGpcTerms: ['Shirts & Tops', 'Apparel & Accessories > Clothing > Shirts & Tops'],
    productTypeSynonyms: ['top', 'blouse', 'shirt', 'button down', 'oxford', 'camisole'],
  },
  SKIRT: {
    canonical: 'SKIRT',
    synonyms: [
      // Core terms
      'skirt', 'skirts',
      // Style variations
      'mini skirt', 'mini skirts', 'midi skirt', 'midi skirts',
      'maxi skirt', 'maxi skirts', 'denim skirt', 'denim skirts',
      'pencil skirt', 'pencil skirts',
    ],
    expandedLeafCats: [
      'skirts', 'denim skirts', 'midi skirts', 'mini skirts', 'maxi skirts',
      'pencil skirts',
    ],
    parentGpcTerms: ['Skirts', 'Apparel & Accessories > Clothing > Skirts'],
    productTypeSynonyms: [
      'skirt', 'denim skirt', 'midi skirt', 'mini skirt', 'maxi skirt', 'pencil skirt',
    ],
  },
  JEANS: {
    canonical: 'JEANS',
    synonyms: [
      // Core terms
      'jean', 'jeans', 'denim', 'denims', 'denim jeans', 'denim pants',
      // Fit variations
      'straight leg', 'straight leg jeans', 'straight jeans', 'straight-leg',
      'bootcut', 'bootcut jeans', 'boot-cut',
      'skinny', 'skinny jeans',
      'slim', 'slim fit jeans', 'slim-fit',
      'relaxed fit', 'relaxed fit jeans', 'relaxed-fit',
      'regular fit', 'regular fit jeans',
      'wide leg', 'wide leg jeans', 'wide-leg',
      'flare', 'flared', 'flared jeans',
      // Style variations
      'carpenter', 'carpenter jeans', 'utility', 'utility jeans',
      'cargo', 'cargo jeans',
      'high rise', 'high-rise', 'high rise jeans',
      'mid rise', 'mid-rise', 'mid rise jeans',
      'low rise', 'low-rise', 'low rise jeans',
      'boyfriend', 'boyfriend jeans',
      'mom jeans', 'mom jean',
    ],
    expandedLeafCats: [
      'jeans', 'skinny jeans', 'straight leg jeans', 'straight jeans', 'bootcut jeans', 'wide leg jeans',
      'relaxed fit jeans', 'carpenter jeans', 'utility jeans', 'cargo jeans',
      'high rise jeans', 'mid rise jeans', 'low rise jeans', 'boyfriend jeans',
    ],
    parentGpcTerms: ['Pants', 'Apparel & Accessories > Clothing > Pants'],
    productTypeSynonyms: [
      'jean', 'jeans', 'denim', 'straight leg', 'straight', 'bootcut', 'skinny', 'slim',
      'relaxed fit', 'wide leg', 'flare', 'carpenter', 'utility', 'cargo',
      'high rise', 'mid rise', 'low rise', 'boyfriend', 'mom jeans',
    ],
  },
  PANTS: {
    canonical: 'PANTS',
    synonyms: [
      'pant', 'pants', 'trouser', 'trousers', 'slacks', 'chinos', 'leggings',
      'joggers', 'cargo pants', 'work pants',
    ],
    expandedLeafCats: ['pants', 'trousers', 'slacks', 'chinos', 'leggings', 'joggers', 'cargo pants'],
    parentGpcTerms: ['Pants', 'Apparel & Accessories > Clothing > Pants'],
    productTypeSynonyms: ['pant', 'pants', 'trouser', 'slacks', 'chinos', 'leggings', 'joggers'],
  },
  SHORTS: {
    canonical: 'SHORTS',
    synonyms: [
      // Core terms
      'short', 'shorts',
      // Style variations
      'denim shorts', 'bermuda', 'bermuda shorts', 'chino shorts', 'chinos shorts',
      'cargo shorts', 'athletic shorts', 'running shorts', 'bike shorts',
    ],
    expandedLeafCats: [
      'shorts', 'denim shorts', 'bermuda shorts', 'chino shorts', 'cargo shorts', 'bike shorts',
    ],
    parentGpcTerms: ['Shorts', 'Apparel & Accessories > Clothing > Shorts'],
    productTypeSynonyms: [
      'short', 'shorts', 'denim shorts', 'bermuda', 'chino shorts', 'cargo shorts', 'bike shorts',
    ],
  },
  DRESS: {
    canonical: 'DRESS',
    synonyms: [
      'dress', 'dresses', 'gown', 'gowns',
      'mini dress', 'midi dress', 'maxi dress',
      'shift dress', 'wrap dress',
    ],
    expandedLeafCats: ['dresses', 'mini dress', 'midi dress', 'maxi dress', 'shift dress', 'wrap dress'],
    parentGpcTerms: ['Dresses', 'Apparel & Accessories > Clothing > Dresses'],
    productTypeSynonyms: ['dress', 'gown', 'shift dress', 'wrap dress'],
  },
  SWEATER: {
    canonical: 'SWEATER',
    synonyms: [
      'sweater', 'sweaters', 'knit', 'knits',
      'pullover', 'pullovers', 'cardigan', 'cardigans',
      'crewneck sweater',
    ],
    expandedLeafCats: ['sweaters', 'pullovers', 'cardigans', 'knits'],
    parentGpcTerms: ['Sweaters', 'Apparel & Accessories > Clothing > Sweaters'],
    productTypeSynonyms: ['sweater', 'knit', 'pullover', 'cardigan', 'crewneck'],
  },
  HOODIE: {
    canonical: 'HOODIE',
    synonyms: [
      'hoodie', 'hoodies', 'sweatshirt', 'sweatshirts', 'fleece',
      'pullover hoodie', 'zip hoodie',
    ],
    expandedLeafCats: ['hoodies', 'sweatshirts', 'fleece'],
    parentGpcTerms: ['Sweaters', 'Apparel & Accessories > Clothing > Sweaters'],
    productTypeSynonyms: ['hoodie', 'sweatshirt', 'fleece', 'pullover hoodie', 'zip hoodie'],
  },
  JACKET: {
    canonical: 'JACKET',
    synonyms: [
      // Core terms
      'jacket', 'jackets', 'coat', 'coats', 'blazer', 'blazers',
      // Style variations
      'denim jacket', 'trench', 'trench coat', 'bomber', 'bomber jacket',
      'shacket', 'shackets', 'parka', 'parkas', 'puffer',
      // Related outerwear
      'vest', 'vests',
      // Generic term
      'outerwear',
    ],
    expandedLeafCats: [
      'outerwear', 'blazer', 'jacket', 'coat', 'denim jacket',
      'trench coat', 'bomber jacket', 'parka', 'puffer', 'vest',
    ],
    parentGpcTerms: ['Outerwear', 'Apparel & Accessories > Clothing > Outerwear'],
    productTypeSynonyms: [
      'jacket', 'coat', 'blazer', 'denim jacket', 'trench', 'bomber',
      'shacket', 'parka', 'puffer', 'vest', 'outerwear',
    ],
  },
  SHOES: {
    canonical: 'SHOES',
    synonyms: [
      // Core terms
      'shoe', 'shoes', 'sneaker', 'sneakers', 'trainers', 'boot', 'boots', 'sandal', 'sandals',
      // Style variations
      'heel', 'heels', 'loafer', 'loafers', 'flat', 'flats',
      'athletic shoe', 'running shoe', 'hiking boot', 'work boot',
    ],
    expandedLeafCats: [
      'shoes', 'sneakers', 'trainers', 'boots', 'sandals', 'heels', 'loafers', 'flats',
    ],
    parentGpcTerms: ['Shoes', 'Apparel & Accessories > Shoes'],
    productTypeSynonyms: [
      'shoe', 'sneaker', 'trainer', 'boot', 'sandal', 'heel', 'loafer', 'flat',
    ],
  },
  ACCESSORY: {
    canonical: 'ACCESSORY',
    synonyms: [
      // Bags
      'bag', 'bags', 'handbag', 'handbags', 'purse', 'purses', 'tote', 'totes',
      'crossbody', 'crossbody bag', 'backpack', 'backpacks',
      // Belts
      'belt', 'belts',
      // Hats
      'hat', 'hats', 'cap', 'caps', 'beanie', 'beanies',
      // Scarves
      'scarf', 'scarves',
      // Jewelry
      'jewelry', 'jewellery', 'necklace', 'necklaces', 'bracelet', 'bracelets',
      'earrings', 'earring',
      // Other
      'socks', 'sock', 'underwear', 'briefs', 'boxers', 'bra', 'bras',
    ],
    expandedLeafCats: [
      'bags', 'belts', 'hats', 'scarves', 'jewelry', 'socks', 'underwear',
      'crossbody bags', 'tote bags', 'wallets',
    ],
    parentGpcTerms: ['Accessories', 'Apparel & Accessories > Accessories'],
    productTypeSynonyms: [
      'bag', 'handbag', 'purse', 'tote', 'crossbody', 'backpack', 'belt', 'hat', 'cap', 'beanie',
      'scarf', 'jewelry', 'necklace', 'bracelet', 'earrings', 'socks', 'underwear',
    ],
  },
  UNKNOWN: {
    canonical: 'UNKNOWN',
    synonyms: [],
    expandedLeafCats: [],
    parentGpcTerms: [],
    productTypeSynonyms: [],
  },
};

export const FASHION_CATEGORY_PROFILE: CategoryProfile = {
  name: 'fashion',
  groups: FASHION_CATEGORY_GROUPS,
};

/**
 * Canonicalizes user text to a canonical category
 * Returns the canonical category, matched synonyms, and confidence score
 */
export function canonicalizeCategory(
  userText: string,
  ontology?: { categories: string[]; productTypes: string[] },
  profile?: CategoryProfile | null,
): {
  canonical: CanonicalCategory;
  matchedSynonyms: string[];
  confidence: number; // 0..1
} {
  if (!userText || !userText.trim()) {
    return { canonical: 'UNKNOWN', matchedSynonyms: [], confidence: 0 };
  }

  const groups = profile?.groups;
  if (!groups || Object.keys(groups).length === 0) {
    return { canonical: 'UNKNOWN', matchedSynonyms: [], confidence: 0 };
  }

  const normalized = userText.toLowerCase().trim();
  const matchedSynonyms: string[] = [];
  let bestMatch: CanonicalCategory = 'UNKNOWN';
  let bestConfidence = 0;

  // Check each canonical category for matches
  for (const [canonical, group] of Object.entries(groups) as Array<
    [CanonicalCategory, CanonicalGroup]
  >) {
    if (canonical === 'UNKNOWN') continue;

    // Check exact synonym matches (word boundaries)
    for (const synonym of group.synonyms) {
      const regex = new RegExp(`\\b${synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(normalized)) {
        matchedSynonyms.push(synonym);
        const confidence = synonym.length >= 4 ? 0.9 : 0.7;
        if (confidence > bestConfidence) {
          bestMatch = canonical;
          bestConfidence = confidence;
        }
      }
    }

    // Check if normalized text contains any synonym (partial match)
    for (const synonym of group.synonyms) {
      if (normalized.includes(synonym) && !matchedSynonyms.includes(synonym)) {
        matchedSynonyms.push(synonym);
        const confidence = 0.5; // Partial match gets lower confidence
        if (confidence > bestConfidence) {
          bestMatch = canonical;
          bestConfidence = confidence;
        }
      }
    }
  }

  // If we have ontology, check against actual DB categories for validation
  if (ontology && bestMatch !== 'UNKNOWN') {
    const group = groups[bestMatch];
    const hasMatchingCategory = group.expandedLeafCats.some((leaf) =>
      ontology.categories.some((cat) => cat.toLowerCase().includes(leaf.toLowerCase())),
    );
    if (hasMatchingCategory) {
      bestConfidence = Math.min(bestConfidence + 0.1, 1.0); // Boost confidence if DB has matching category
    }
  }

  return {
    canonical: bestMatch,
    matchedSynonyms: [...new Set(matchedSynonyms)],
    confidence: bestConfidence,
  };
}

/**
 * Gets expanded leaf categories for a canonical category
 * These are the actual category values that might appear in the DB
 */
export function getExpandedLeafCategories(
  canonical: CanonicalCategory,
  ontology?: { categories: string[]; productTypes: string[] },
  profile?: CategoryProfile | null,
): string[] {
  const group = profile?.groups[canonical];
  if (!group) return [];

  // If ontology provided, filter to only categories that exist in DB
  if (ontology) {
    return group.expandedLeafCats.filter((leaf) =>
      ontology.categories.some((cat) => cat.toLowerCase().includes(leaf.toLowerCase())),
    );
  }

  return group.expandedLeafCats;
}

/**
 * Gets parent Google Product Category terms for a canonical category
 */
export function getParentGpcTerms(
  canonical: CanonicalCategory,
  profile?: CategoryProfile | null,
): string[] {
  const group = profile?.groups[canonical];
  return group?.parentGpcTerms || [];
}

/**
 * Gets product type synonyms for a canonical category
 */
export function getSynonymTerms(
  canonical: CanonicalCategory,
  profile?: CategoryProfile | null,
): string[] {
  const group = profile?.groups[canonical];
  return group?.productTypeSynonyms || [];
}

/**
 * Gets ALL synonyms (including productTypeSynonyms) for a canonical category
 * This is used for comprehensive text matching in titles/descriptions
 */
export function getAllSynonyms(
  canonical: CanonicalCategory,
  profile?: CategoryProfile | null,
): string[] {
  const group = profile?.groups[canonical];
  if (!group) return [];
  
  // Combine all synonym arrays and deduplicate
  const all = [
    ...group.synonyms,
    ...group.productTypeSynonyms,
    ...group.expandedLeafCats,
  ];
  return [...new Set(all.map(s => s.toLowerCase()))];
}

/**
 * Auto-generates variant forms of a keyword for synonym expansion
 * Creates spaced, hyphenated, concatenated, singular, and plural forms
 */
export function generateSynonymVariants(keyword: string): string[] {
  const variants = new Set<string>();
  const normalized = keyword.toLowerCase().trim();
  
  // Add original
  variants.add(normalized);
  
  // Simple pluralization rules (basic cases)
  const pluralize = (word: string): string => {
    if (word.endsWith('s') || word.endsWith('x') || word.endsWith('z') || word.endsWith('ch') || word.endsWith('sh')) {
      return word + 'es';
    }
    if (word.endsWith('y') && !/[aeiou]y$/.test(word)) {
      return word.slice(0, -1) + 'ies';
    }
    if (word.endsWith('f')) {
      return word.slice(0, -1) + 'ves';
    }
    if (word.endsWith('fe')) {
      return word.slice(0, -2) + 'ves';
    }
    return word + 's';
  };
  
  const singularize = (word: string): string => {
    if (word.endsWith('ies') && word.length > 4) {
      return word.slice(0, -3) + 'y';
    }
    if (word.endsWith('ves') && word.length > 4) {
      return word.slice(0, -3) + 'f';
    }
    if (word.endsWith('es') && (word.endsWith('ches') || word.endsWith('shes') || word.endsWith('xes'))) {
      return word.slice(0, -2);
    }
    if (word.endsWith('s') && word.length > 1) {
      return word.slice(0, -1);
    }
    return word;
  };
  
  // Add plural
  if (!normalized.endsWith('s')) {
    variants.add(pluralize(normalized));
  }
  
  // Add singular
  if (normalized.endsWith('s')) {
    variants.add(singularize(normalized));
  }
  
  // Generate spaced/hyphen/concatenated variants for multi-word terms
  if (normalized.includes(' ')) {
    const parts = normalized.split(/\s+/);
    if (parts.length === 2) {
      const [part1, part2] = parts;
      // Hyphenated: "t-shirt"
      variants.add(`${part1}-${part2}`);
      // Concatenated: "tshirt"
      variants.add(`${part1}${part2}`);
      // With plural on first part
      variants.add(`${pluralize(part1)}-${part2}`);
      variants.add(`${pluralize(part1)}${part2}`);
      // With plural on second part
      variants.add(`${part1}-${pluralize(part2)}`);
      variants.add(`${part1}${pluralize(part2)}`);
    }
  } else if (normalized.includes('-')) {
    // If hyphenated, try spaced and concatenated
    const parts = normalized.split('-');
    if (parts.length === 2) {
      const [part1, part2] = parts;
      variants.add(`${part1} ${part2}`);
      variants.add(`${part1}${part2}`);
    }
  } else if (normalized.length > 3) {
    // Try to split concatenated words (heuristic: look for common patterns)
    // e.g., "tshirt" -> "t shirt", "t-shirt"
    if (normalized.startsWith('t') && normalized.length > 4) {
      variants.add(`t ${normalized.slice(1)}`);
      variants.add(`t-${normalized.slice(1)}`);
    }
  }
  
  return Array.from(variants).filter(v => v.length >= 2);
}

const FASHION_PROFILE_KEYWORDS = [
  'tshirt',
  't shirt',
  'tee',
  'tank',
  'dress',
  'gown',
  'skirt',
  'jean',
  'denim',
  'jogger',
  'hoodie',
  'sweater',
  'outerwear',
  'jacket',
  'sneaker',
  'boot',
  'heels',
  'shorts',
  'blazer',
];

/**
 * Detects whether the catalog looks like a fashion/apparel dataset.
 * Uses ontology metadata and optional vertical hints from dataset context.
 */
export function detectCategoryProfile(
  ontology?: { categories: string[]; productTypes: string[] },
  options?: { verticalHint?: string | null },
): CategoryProfile | null {
  const vertical = options?.verticalHint?.toLowerCase();
  if (vertical && /(apparel|fashion|clothing)/.test(vertical)) {
    return FASHION_CATEGORY_PROFILE;
  }

  if (!ontology) return null;
  const haystack = [...(ontology.categories || []), ...(ontology.productTypes || [])]
    .map((value) => value?.toLowerCase?.())
    .filter(Boolean) as string[];

  const hasFashionSignal = FASHION_PROFILE_KEYWORDS.some((keyword) =>
    haystack.some((value) => value.includes(keyword)),
  );

  return hasFashionSignal ? FASHION_CATEGORY_PROFILE : null;
}

/**
 * Expands keywords with all variant forms for comprehensive matching
 * Used in search to match user language variations
 */
export function expandKeywordsForSearch(keywords: string[]): string[] {
  const expanded = new Set<string>();
  
  for (const keyword of keywords) {
    const variants = generateSynonymVariants(keyword);
    for (const variant of variants) {
      expanded.add(variant);
    }
  }
  
  return Array.from(expanded);
}

/**
 * Color mapping: maps user color terms to canonical color groups
 * Then validates against catalog ontology
 */
export const COLOR_GROUP_MAP: Record<string, string[]> = {
  black: ['black', 'charcoal', 'jet', 'ink'],
  white: ['white', 'ivory', 'cream', 'off white'],
  blue: ['blue', 'navy', 'cobalt', 'sky', 'teal'],
  green: ['green', 'olive', 'sage', 'emerald'],
  red: ['red', 'maroon', 'burgundy', 'wine'],
  yellow: ['yellow', 'gold', 'mustard'],
  pink: ['pink', 'rose', 'fuchsia'],
  purple: ['purple', 'lavender', 'violet'],
  orange: ['orange', 'rust', 'coral'],
  brown: ['brown', 'tan', 'camel', 'beige', 'khaki'],
  gray: ['gray', 'grey', 'silver', 'ash'],
  multi: ['multicolor', 'printed', 'stripe', 'striped', 'floral', 'graphic'],
};

/**
 * Maps user color input to canonical color group, then validates against catalog
 * Returns array of valid colors from catalog ontology
 */
export function mapColorToCatalog(
  userColor: string,
  catalogColors: string[],
): string[] {
  const normalized = userColor.toLowerCase().trim();
  const catalogLower = catalogColors.map(c => c.toLowerCase());
  
  // Find matching color group
  for (const [group, variants] of Object.entries(COLOR_GROUP_MAP)) {
    if (variants.some(v => normalized === v || normalized.includes(v) || v.includes(normalized))) {
      // Map group variants to catalog colors
      const matchingCatalogColors = catalogLower
        .filter(catColor => {
          return variants.some(variant => 
            catColor === variant || 
            catColor.includes(variant) || 
            variant.includes(catColor)
          );
        })
        .map(catColor => {
          // Return original case from catalog
          const index = catalogLower.indexOf(catColor);
          return catalogColors[index];
        });
      
      if (matchingCatalogColors.length > 0) {
        return matchingCatalogColors;
      }
    }
  }
  
  // Direct match against catalog
  const directMatch = catalogColors.find(c => 
    c.toLowerCase() === normalized || 
    c.toLowerCase().includes(normalized) ||
    normalized.includes(c.toLowerCase())
  );
  
  return directMatch ? [directMatch] : [];
}

/**
 * Material mapping: maps user material terms to catalog material strings
 * Uses substring matching (e.g., "cotton" matches "75% Cotton 21% Polyester")
 */
export const MATERIAL_GROUP_MAP: Record<string, string[]> = {
  cotton: ['cotton', 'organic cotton', 'pima'],
  denim: ['denim', 'jean'],
  linen: ['linen', 'flax'],
  polyester: ['polyester', 'poly'],
  spandex: ['spandex', 'elastane', 'lycra', 'stretch'],
  viscose: ['viscose', 'rayon'],
  wool: ['wool', 'merino'],
  leather: ['leather', 'faux leather', 'pu'],
};

/**
 * Maps user material input to catalog material terms
 * Returns array of material keywords for substring matching
 */
export function mapMaterialToCatalog(userMaterial: string): string[] {
  const normalized = userMaterial.toLowerCase().trim();
  
  // Find matching material group
  for (const [group, variants] of Object.entries(MATERIAL_GROUP_MAP)) {
    if (variants.some(v => normalized === v || normalized.includes(v) || v.includes(normalized))) {
      return variants;
    }
  }
  
  // Return as-is if no group match
  return [normalized];
}

