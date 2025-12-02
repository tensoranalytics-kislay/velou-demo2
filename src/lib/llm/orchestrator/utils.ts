import type { SearchConstraints } from '../../search/types';

export const stripJsonFences = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : trimmed.replace(/```/g, '').trim();
};

export const pushUnique = (list: string[] | undefined, value: string): string[] => {
  if (!value) return list ?? [];
  const arr = list ? [...list] : [];
  if (!arr.includes(value)) {
    arr.push(value);
  }
  return arr;
};

export const coerceStringArray = (value: unknown): string[] | undefined => {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const result = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry)))
      .filter(Boolean);
    return result.length ? result : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : undefined;
  }
  return undefined;
};

/**
 * Extracts gender from user message (mens, womens, unisex)
 * Handles negation patterns and explicit overrides
 * Returns array of genders or undefined
 */
export function extractGenderFromText(text: string): string[] | undefined {
  const t = text.toLowerCase();
  
  // Handle explicit overrides/negations first
  if (/(not for men|no men|without men|not men).*(women|womens|female|for her|ladies|girls)/.test(t)) {
    return ['womens'];
  }
  if (/(not for women|no women|without women|not women).*(men|mens|male|for him|guys|gents)/.test(t)) {
    return ['mens'];
  }
  
  // Unisex/gender neutral patterns
  if (/(unisex|gender neutral|all genders|for everyone|for all)/.test(t)) {
    return ['unisex'];
  }
  
  // Mens patterns (check after negation to avoid false positives)
  if (/(men|mens|men's|male|males|for him|guys|gents|boyfriend|menswear)/.test(t)) {
    return ['mens'];
  }
  
  // Womens patterns
  if (/(women|womens|women's|female|females|for her|girls|ladies|girlfriend|womenswear)/.test(t)) {
    return ['womens'];
  }
  
  return undefined;
}

/**
 * Legacy alias for extractGenderFromText (returns first gender or null)
 * @deprecated Use extractGenderFromText instead
 */
export function extractGenderFromMessage(message: string): string | null {
  const genders = extractGenderFromText(message);
  return genders?.[0] || null;
}

/**
 * Normalizes constraint values to remove bad sentinel values (empty strings, 0, null, etc.)
 * CRITICAL: Prisma requires undefined (omit) not null for optional filters
 */
export const normalizeConstraintValues = (constraints: SearchConstraints): SearchConstraints => {
  const normalized = { ...constraints };

  // Convert empty strings to undefined for scalar fields
  // Fix C: Handle category as string or array
  if (Array.isArray(normalized.category)) {
    normalized.category = normalized.category.filter(c => c && c.trim() !== '');
    if (normalized.category.length === 0) normalized.category = undefined;
  } else {
    if (normalized.category === '') normalized.category = undefined;
    if (normalized.category === null) normalized.category = undefined;
  }
  if (normalized.fit === '') normalized.fit = undefined;
  if (normalized.query === '') normalized.query = undefined;

  // Convert null to undefined for price fields (Prisma requires undefined, not null)
  // LLM returns null for missing fields, but Prisma will throw "gte must not be null"
  if (normalized.priceMinCents === null || normalized.priceMinCents === 0) {
    normalized.priceMinCents = undefined;
  }
  if (normalized.priceMaxCents === null || normalized.priceMaxCents === 0) {
    normalized.priceMaxCents = undefined;
  }
  
  // Also convert null to undefined for fit
  if (normalized.fit === null) normalized.fit = undefined;

  // Filter out empty strings from arrays
  const cleanArray = (arr: string[] | undefined): string[] | undefined => {
    if (!arr) return undefined;
    const cleaned = arr.filter((item) => item.trim() !== '');
    return cleaned.length > 0 ? cleaned : undefined;
  };

  normalized.colors = cleanArray(normalized.colors);
  normalized.sizes = cleanArray(normalized.sizes);
  normalized.fabrics = cleanArray(normalized.fabrics);
  normalized.seasons = cleanArray(normalized.seasons);
  normalized.occasions = cleanArray(normalized.occasions);
  normalized.useCases = cleanArray(normalized.useCases);
  normalized.styleTags = cleanArray(normalized.styleTags);
  normalized.benefits = cleanArray(normalized.benefits);
  normalized.claims = cleanArray(normalized.claims);
  normalized.compatibility = cleanArray(normalized.compatibility);
  // sensoryProfile is a string, not an array
  if (normalized.sensoryProfile === '' || normalized.sensoryProfile === null) {
    normalized.sensoryProfile = undefined;
  }
  normalized.brands = cleanArray(normalized.brands);
  normalized.genders = cleanArray(normalized.genders);
  normalized.materials = cleanArray(normalized.materials);
  normalized.productTypes = cleanArray(normalized.productTypes);
  normalized.googleCategories = cleanArray(normalized.googleCategories);
  normalized.customLabels4 = cleanArray(normalized.customLabels4);
  normalized.conditions = cleanArray(normalized.conditions);
  normalized.ageGroups = cleanArray(normalized.ageGroups);

  return normalized;
};

export const normalizeConstraintArrays = (constraints: SearchConstraints) => {
  constraints.colors = coerceStringArray(constraints.colors);
  constraints.sizes = coerceStringArray(constraints.sizes);
  constraints.fabrics = coerceStringArray(constraints.fabrics);
  constraints.seasons = coerceStringArray(constraints.seasons);
  constraints.occasions = coerceStringArray(constraints.occasions);
  constraints.useCases = coerceStringArray(constraints.useCases);
  constraints.styleTags = coerceStringArray(constraints.styleTags);
  constraints.benefits = coerceStringArray(constraints.benefits);
  constraints.claims = coerceStringArray(constraints.claims);
  constraints.compatibility = coerceStringArray(constraints.compatibility);
  // sensoryProfile is a string, not an array - no normalization needed here
  constraints.brands = coerceStringArray(constraints.brands);
  constraints.genders = coerceStringArray(constraints.genders);
  constraints.materials = coerceStringArray(constraints.materials);
  constraints.productTypes = coerceStringArray(constraints.productTypes);
  constraints.googleCategories = coerceStringArray(constraints.googleCategories);
  constraints.customLabels4 = coerceStringArray(constraints.customLabels4);
  constraints.conditions = coerceStringArray(constraints.conditions);
  constraints.ageGroups = coerceStringArray(constraints.ageGroups);
  return constraints;
};

export const extractNegatedTokens = (message: string): string[] => {
  const matches = [];
  const regex = /\b(?:no|not)\s+([a-zA-Z]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(message.toLowerCase()))) {
    matches.push(match[1]);
  }
  return matches;
};

export const mergeArrays = (base: string[] | undefined, incoming: string[] | undefined, negated: string[]) => {
  const normalizedNegated = new Set(negated.map((token) => token.toLowerCase()));
  const combined = new Set<string>();
  for (const value of base ?? []) {
    if (!normalizedNegated.has(value.toLowerCase())) {
      combined.add(value);
    }
  }
  for (const value of incoming ?? []) {
    if (!normalizedNegated.has(value.toLowerCase())) {
      combined.add(value);
    }
  }
  return combined.size ? Array.from(combined) : undefined;
};

export const fuzzyMatchValue = (value: string | undefined, list: string[] | undefined) => {
  if (!value || !list?.length) return undefined;
  const target = value.trim().toLowerCase();
  if (!target) return undefined;
  const exact = list.find((entry) => entry.toLowerCase() === target);
  if (exact) return exact;
  const contains = list.find(
    (entry) => entry.toLowerCase().includes(target) || target.includes(entry.toLowerCase()),
  );
  return contains;
};

/**
 * Fix A: Deterministic synonym normalization for category extraction
 * Maps common product type synonyms to exact taxonomy terms
 */
export const CATEGORY_SYNONYM_MAP: Record<string, string> = {
  // T-shirt/tee variations -> "t shirt" (or specific leaf if available)
  tshirt: 't shirt',
  't-shirt': 't shirt',
  't-shirts': 't shirt',
  't shirts': 't shirt',
  tee: 't shirt',
  tees: 't shirt',
  'tee shirt': 't shirt',
  'tee shirts': 't shirt',
  'graphic tee': 't shirt',
  'graphic tees': 't shirt',
  'graphic t-shirt': 't shirt',
  'graphic tshirt': 't shirt',
  // Skirt variations
  skirt: 'skirts',
  skirts: 'skirts',
  // Jeans variations
  jean: 'jeans',
  jeans: 'jeans',
  // Pants variations
  pant: 'pants',
  pants: 'pants',
  trouser: 'pants',
  trousers: 'pants',
  // Top variations
  top: 'tops',
  tops: 'tops',
  blouse: 'tops',
  // Shirt variations (non-tee)
  shirt: 'shirt',
  shirts: 'shirt',
  // Dress variations
  dress: 'dresses',
  dresses: 'dresses',
  gown: 'dresses',
  // Shorts variations
  short: 'shorts',
  shorts: 'shorts',
  // Outerwear variations
  jacket: 'outerwear',
  jackets: 'outerwear',
  coat: 'outerwear',
  coats: 'outerwear',
  outerwear: 'outerwear',
  // Sweater variations
  sweater: 'sweaters',
  sweaters: 'sweaters',
  // Blazer variations
  blazer: 'blazer',
  blazers: 'blazer',
  // Accessories
  bag: 'bags',
  bags: 'bags',
  handbag: 'bags',
  handbags: 'bags',
  purse: 'bags',
  tote: 'bags',
  crossbody: 'bags',
  belt: 'belts',
  belts: 'belts',
  shoe: 'shoes',
  shoes: 'shoes',
  sneaker: 'shoes',
  sneakers: 'shoes',
  boot: 'shoes',
  boots: 'shoes',
  sandal: 'shoes',
  sandals: 'shoes',
};

/**
 * Normalizes category from user message using deterministic synonym mapping
 * This runs BEFORE LLM extraction to catch cases where LLM misses category
 */
export function normalizeCategoryFromMessage(
  message: string,
  llmCategory: string | undefined,
  ontology: { categories: string[]; productTypes: string[] },
): string | undefined {
  // If LLM already extracted a valid category, use it
  if (llmCategory) {
    // Verify it's in the ontology
    const normalized = message.toLowerCase().trim();
    const allValidCategories = [...ontology.categories, ...ontology.productTypes];
    const exactMatch = allValidCategories.find(
      (cat) => cat.toLowerCase() === llmCategory.toLowerCase(),
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  // Extract category from message using synonym map
  const normalized = message.toLowerCase().trim();
  
  // Check for exact synonym matches
  for (const [synonym, category] of Object.entries(CATEGORY_SYNONYM_MAP)) {
    // Use word boundaries to avoid partial matches
    const regex = new RegExp(`\\b${synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(normalized)) {
      // Verify the mapped category exists in ontology
      const allValidCategories = [...ontology.categories, ...ontology.productTypes];
      const match = allValidCategories.find(
        (cat) => cat.toLowerCase().includes(category.toLowerCase()) || category.toLowerCase().includes(cat.toLowerCase()),
      );
      if (match) {
        return match;
      }
      // If no exact match, try the category as-is (might be a valid taxonomy term)
      return category;
    }
  }

  return llmCategory;
}

/**
 * Extracts hard text filter keywords from message for SQL fallback
 * Returns array of keywords that should be used for hard filtering when category is missing
 */
export function extractHardTextFilterKeywords(
  message: string,
  normalizedCategory: string | undefined,
): string[] {
  const keywords: string[] = [];
  const normalized = message.toLowerCase().trim();

  // If category is missing but message contains product type keywords, extract them
  if (!normalizedCategory) {
    // T-shirt keywords
    if (/\b(tshirt|t-shirt|t shirts|tee|tees|tee shirt|graphic tee)\b/i.test(normalized)) {
      keywords.push('t shirt', 'tshirt', 'tee');
    }
    // Skirt keywords
    if (/\bskirt/i.test(normalized)) {
      keywords.push('skirt');
    }
    // Jeans keywords
    if (/\bjean/i.test(normalized)) {
      keywords.push('jean');
    }
    // Dress keywords
    if (/\bdress/i.test(normalized)) {
      keywords.push('dress');
    }
    // Shoe keywords
    if (/\b(shoe|sneaker|boot|sandal)/i.test(normalized)) {
      keywords.push('shoe', 'sneaker', 'boot', 'sandal');
    }
    // Bag keywords
    if (/\b(bag|handbag|purse|tote|crossbody)/i.test(normalized)) {
      keywords.push('bag', 'handbag', 'purse', 'tote');
    }
    // Belt keywords
    if (/\bbelt/i.test(normalized)) {
      keywords.push('belt');
    }
  }

  return [...new Set(keywords)]; // Deduplicate
}

/**
 * Deterministic gender token detector
 * Extracts gender from user message: men|mens|male|boy|guy|him => ["mens"]
 * women|womens|female|girl|lady|her => ["womens"]
 * unisex => ["unisex"]
 * If both men & women appear, return ["unisex"]
 */
export function detectGenderTokens(message: string): string[] | undefined {
  const normalized = message.toLowerCase();
  
  // Handle explicit negations first (e.g., "not for men, for women")
  if (/(not for men|no men|without men).*(women|womens|female|for her)/.test(normalized)) {
    return ['womens'];
  }
  if (/(not for women|no women|without women).*(men|mens|male|for him)/.test(normalized)) {
    return ['mens'];
  }
  
  // Check for both men and women patterns (unisex) - but only if not negated
  // Use word boundaries but also handle apostrophes in "women's", "men's"
  const hasMen = /\b(men|mens|men'?s|male|males|boy|boys|guy|guys|him|gents|menswear)\b/.test(normalized);
  const hasWomen = /\b(women|womens|women'?s|female|females|girl|girls|lady|ladies|her|womenswear)\b/.test(normalized);
  
  if (hasMen && hasWomen) {
    return ['unisex'];
  }
  
  if (hasMen) {
    return ['mens'];
  }
  
  if (hasWomen) {
    return ['womens'];
  }
  
  if (/\b(unisex|gender neutral|all genders|for everyone|for all)\b/.test(normalized)) {
    return ['unisex'];
  }
  
  return undefined;
}

