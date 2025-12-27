/**
 * Category Metadata Dictionary
 * 
 * Maps each of the 48 categories to their applicable constraints based on actual dataset attributes.
 * This ensures context-aware constraint filtering and prevents false negatives.
 */

export type CategoryConstraintConfig = {
  // Constraints that should be applied as SQL filters
  applicableConstraints: Array<'colors' | 'sizes' | 'fabrics' | 'materials' | 'occasions' | 'seasons' | 'fit' | 'price'>;
  // Constraints that should NOT be applied as SQL filters but searched in text
  textOnlyConstraints: Array<'colors' | 'fabrics' | 'materials'>;
  // Context-dependent word mappings (e.g., "lavender" → "scent" for Perfumes)
  contextWordMappings?: Record<string, string>;
  // Fallback strategy when strict filters return 0 results
  fallbackStrategy: 'vector' | 'keyword' | 'both';
  // Allow keyword matching in titles/descriptions for context-dependent words
  allowKeywordMatching: boolean;
};

export const CATEGORY_METADATA: Record<string, CategoryConstraintConfig> = {
  // Kids Categories (8)
  'Girls Tops': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Girls Bottoms': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Girls Dresses': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Girls Swimwear': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Baby & Toddler Bottoms': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Tween Pants': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Tween Sweaters': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Tween Dresses': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },

  // Women's / Adult Apparel (21)
  'Women\'s Dresses': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Tops': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Bottoms': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Skirts': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Skorts': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Activewear': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Swimsuits': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Bikini Sets': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Swim Cover-ups': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Cold Weather Essentials': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Loungewear': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Robes': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Pajama Set': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Shoes': {
    applicableConstraints: ['colors', 'sizes', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: ['materials'], // Materials may be mentioned but not as structured attribute
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Ski Jackets': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Ski Tops': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Ski Shoes': {
    applicableConstraints: ['colors', 'sizes', 'materials', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Sweaters': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Mini Dress': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Maxi Dress': {
    applicableConstraints: ['colors', 'sizes', 'fabrics', 'materials', 'occasions', 'seasons', 'fit', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Tote Bags': {
    applicableConstraints: ['colors', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: ['materials'], // Materials may be mentioned but not as structured attribute
    contextWordMappings: {
      'travel': 'use',
      'beach': 'use',
      'shopping': 'use',
      'work': 'use',
      'office': 'use',
      'everyday': 'use',
      'large': 'size',
      'small': 'size',
      'medium': 'size',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },

  // Accessories (7)
  'Accessories': {
    applicableConstraints: ['colors', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: ['materials'], // Materials may be mentioned but not consistently structured
    contextWordMappings: {
      'gift': 'use',
      'wedding': 'use',
      'party': 'use',
      'travel': 'use',
      'everyday': 'use',
      'special occasion': 'use',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Jewelry': {
    applicableConstraints: ['colors', 'materials', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: [],
    contextWordMappings: {
      'wedding': 'use',
      'engagement': 'use',
      'anniversary': 'use',
      'gift': 'use',
      'everyday': 'use',
      'special occasion': 'use',
      'party': 'use',
      'gold': 'material',
      'silver': 'material',
      'platinum': 'material',
      'diamond': 'material',
      'pearl': 'material',
      'gemstone': 'material',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Hair Accessories': {
    applicableConstraints: ['colors', 'materials', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: [],
    contextWordMappings: {
      'wedding': 'use',
      'party': 'use',
      'everyday': 'use',
      'formal': 'use',
      'casual': 'use',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Pocket Squares': {
    applicableConstraints: ['colors', 'materials', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  },
  'Phone Cases': {
    applicableConstraints: ['colors', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: ['materials'], // Materials may be mentioned but not as structured attribute
    contextWordMappings: {
      'protective': 'use',
      'durable': 'use',
      'stylish': 'use',
      'elegant': 'use',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Soap Dispensers': {
    applicableConstraints: ['colors', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: ['materials'], // Materials may be mentioned but not as structured attribute
    contextWordMappings: {
      'bathroom': 'room',
      'kitchen': 'room',
      'guest bathroom': 'room',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Makeup Kit': {
    applicableConstraints: ['colors', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: ['materials'], // Materials may be mentioned but not as structured attribute
    contextWordMappings: {
      'travel': 'use',
      'gift': 'use',
      'everyday': 'use',
      'professional': 'use',
      'complete': 'use',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },

  // Personal Care (1)
  'Perfumes': {
    applicableConstraints: ['price', 'occasions'], // NO colors, materials as SQL filters
    textOnlyConstraints: ['colors'], // Search "lavender" in title/description, not as color filter
    contextWordMappings: {
      'lavender': 'scent',
      'lavendar': 'scent', // Common misspelling
      'rose': 'scent',
      'vanilla': 'scent',
      'jasmine': 'scent',
      'peony': 'scent',
      'gardenia': 'scent',
      'sandalwood': 'scent',
      'strawberry': 'scent',
      'pear': 'scent',
      'coconut': 'scent',
      'bergamot': 'scent',
      'raspberry': 'scent',
      'marshmallow': 'scent',
      'blueberry': 'scent',
      'plum': 'scent',
      'blackcurrant': 'scent',
      'velvet': 'scent',
      'green': 'scent', // "green pear" is a scent note
      'citrus': 'scent',
      'lemon': 'scent',
      'orange': 'scent',
      'grapefruit': 'scent',
      'lime': 'scent',
      'mint': 'scent',
      'eucalyptus': 'scent',
      'cedar': 'scent',
      'oak': 'scent',
      'amber': 'scent',
      'musk': 'scent',
      'patchouli': 'scent',
      'ylang': 'scent',
      'ylang-ylang': 'scent',
      'neroli': 'scent',
      'champagne': 'scent',
      'honey': 'scent',
      'caramel': 'scent',
      'chocolate': 'scent',
      'coffee': 'scent',
      'tea': 'scent',
      'tobacco': 'scent',
      'leather': 'scent',
      'ocean': 'scent',
      'marine': 'scent',
      'aquatic': 'scent',
    },
    fallbackStrategy: 'both',
    allowKeywordMatching: true,
  },

  // Home & Living (11)
  'Bedding': {
    applicableConstraints: ['colors', 'materials', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: [],
    contextWordMappings: {
      'bedroom': 'room',
      'master bedroom': 'room',
      'guest room': 'room',
      'nursery': 'room',
      'kids room': 'room',
      'children room': 'room',
      'king': 'size',
      'queen': 'size',
      'full': 'size',
      'twin': 'size',
      'california king': 'size',
      'large': 'size',
      'small': 'size',
      'luxury': 'style',
      'premium': 'style',
      'soft': 'style',
      'silky': 'style',
      'smooth': 'style',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Bathroom': {
    applicableConstraints: ['colors', 'materials', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: [],
    contextWordMappings: {
      'bathroom': 'room',
      'master bathroom': 'room',
      'guest bathroom': 'room',
      'powder room': 'room',
      'ensuite': 'room',
      'large': 'size',
      'small': 'size',
      'compact': 'size',
      'spa': 'style',
      'luxury': 'style',
      'modern': 'style',
      'traditional': 'style',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Towels': {
    applicableConstraints: ['colors', 'materials', 'sizes', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: [],
    contextWordMappings: {
      'bath towel': 'size',
      'hand towel': 'size',
      'washcloth': 'size',
      'beach towel': 'size',
      'large': 'size',
      'small': 'size',
      'soft': 'material',
      'plush': 'material',
      'absorbent': 'material',
      'quick dry': 'material',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Tabletop': {
    applicableConstraints: ['colors', 'materials', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: [],
    contextWordMappings: {
      'dining room': 'room',
      'dining': 'room',
      'kitchen': 'room',
      'breakfast nook': 'room',
      'outdoor dining': 'room',
      'patio': 'room',
      'large': 'size',
      'small': 'size',
      'set': 'size',
      'collection': 'size',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Kitchen & Dining': {
    applicableConstraints: ['colors', 'materials', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: [],
    contextWordMappings: {
      'kitchen': 'room',
      'dining room': 'room',
      'dining': 'room',
      'breakfast nook': 'room',
      'outdoor dining': 'room',
      'patio': 'room',
      'large': 'size',
      'small': 'size',
      'compact': 'size',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Stationary': {
    applicableConstraints: ['colors', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: ['materials'], // NO material attribute in dataset
    contextWordMappings: {
      'office': 'use',
      'desk': 'use',
      'work': 'use',
      'school': 'use',
      'gift': 'use',
      'wedding': 'use',
      'party': 'use',
      'elegant': 'style',
      'luxury': 'style',
      'premium': 'style',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Interiors': {
    applicableConstraints: ['colors', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: ['materials'], // NO material attribute in dataset
    contextWordMappings: {
      'living room': 'room',
      'bedroom': 'room',
      'dining room': 'room',
      'dining': 'room',
      'kitchen': 'room',
      'bathroom': 'room',
      'office': 'room',
      'nursery': 'room',
      'entryway': 'room',
      'foyer': 'room',
      'hallway': 'room',
      'patio': 'room',
      'outdoor': 'room',
      'balcony': 'room',
      'terrace': 'room',
      'large': 'size',
      'small': 'size',
      'compact': 'size',
      'spacious': 'size',
      'wallpaper': 'style',
      'wall decor': 'style',
      'wall decoration': 'style',
      'art': 'style',
      'print': 'style',
      'framed': 'style',
      'decorative': 'style',
      'accent': 'style',
      'statement': 'style',
      'minimalist': 'style',
      'modern': 'style',
      'traditional': 'style',
      'vintage': 'style',
      'rustic': 'style',
      'bohemian': 'style',
      'scandinavian': 'style',
    },
    fallbackStrategy: 'both',
    allowKeywordMatching: true,
  },
  'Candle': {
    applicableConstraints: ['colors', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: ['materials'], // NO material attribute in dataset
    contextWordMappings: {
      'lavender': 'scent',
      'lavendar': 'scent',
      'rose': 'scent',
      'vanilla': 'scent',
      'jasmine': 'scent',
      'coconut': 'scent',
      'bergamot': 'scent',
      'sandalwood': 'scent',
      'citrus': 'scent',
      'lemon': 'scent',
      'orange': 'scent',
      'living room': 'room',
      'bedroom': 'room',
      'bathroom': 'room',
      'kitchen': 'room',
      'dining room': 'room',
      'large': 'size',
      'small': 'size',
      'travel': 'size',
    },
    fallbackStrategy: 'both',
    allowKeywordMatching: true,
  },
  'Decorative Dishes': {
    applicableConstraints: ['colors', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: ['materials'], // Materials may be mentioned but not as structured attribute
    contextWordMappings: {
      'living room': 'room',
      'dining room': 'room',
      'dining': 'room',
      'kitchen': 'room',
      'bedroom': 'room',
      'entryway': 'room',
      'display': 'use',
      'decorative': 'use',
      'serving': 'use',
      'centerpiece': 'use',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Fragrance Tray': {
    applicableConstraints: ['colors', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: ['materials'], // Materials may be mentioned but not as structured attribute
    contextWordMappings: {
      'bathroom': 'room',
      'bedroom': 'room',
      'living room': 'room',
      'entryway': 'room',
      'display': 'use',
      'decorative': 'use',
      'organizer': 'use',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
  'Pets': {
    applicableConstraints: ['colors', 'materials', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: [],
    contextWordMappings: {
      'dog': 'pet',
      'cat': 'pet',
      'puppy': 'pet',
      'kitten': 'pet',
      'large': 'size',
      'small': 'size',
      'medium': 'size',
      'bed': 'use',
      'toy': 'use',
      'bowl': 'use',
      'accessory': 'use',
    },
    fallbackStrategy: 'vector',
    allowKeywordMatching: true,
  },
};

/**
 * Get metadata for a category, with fallback to default config
 */
export function getCategoryMetadata(category: string): CategoryConstraintConfig {
  return CATEGORY_METADATA[category] || {
    applicableConstraints: ['colors', 'sizes', 'materials', 'occasions', 'seasons', 'price'],
    textOnlyConstraints: [],
    fallbackStrategy: 'vector',
    allowKeywordMatching: false,
  };
}

/**
 * Get metadata for multiple categories (use most permissive config)
 */
export function getCategoriesMetadata(categories: string[]): CategoryConstraintConfig {
  if (categories.length === 0) {
    return getCategoryMetadata('');
  }

  // If all categories have the same config, return it
  const firstConfig = getCategoryMetadata(categories[0]);
  const allSame = categories.every(cat => {
    const config = getCategoryMetadata(cat);
    return JSON.stringify(config.applicableConstraints) === JSON.stringify(firstConfig.applicableConstraints) &&
           JSON.stringify(config.textOnlyConstraints) === JSON.stringify(firstConfig.textOnlyConstraints) &&
           config.fallbackStrategy === firstConfig.fallbackStrategy &&
           config.allowKeywordMatching === firstConfig.allowKeywordMatching;
  });

  if (allSame) {
    return firstConfig;
  }

  // Merge configs: use union of applicable constraints, intersection of text-only constraints
  const applicableSet = new Set<string>();
  const textOnlySet = new Set<'colors' | 'fabrics' | 'materials'>();
  const contextMappings: Record<string, string> = {};
  let fallbackStrategy: 'vector' | 'keyword' | 'both' = 'vector';
  let allowKeywordMatching = false;

  categories.forEach(cat => {
    const config = getCategoryMetadata(cat);
    config.applicableConstraints.forEach(c => applicableSet.add(c));
    config.textOnlyConstraints.forEach(c => {
      if (c === 'colors' || c === 'fabrics' || c === 'materials') {
        textOnlySet.add(c);
      }
    });
    if (config.contextWordMappings) {
      Object.assign(contextMappings, config.contextWordMappings);
    }
    if (config.fallbackStrategy === 'both') {
      fallbackStrategy = 'both';
    } else if (config.fallbackStrategy === 'keyword' && fallbackStrategy !== 'both') {
      fallbackStrategy = 'keyword';
    }
    if (config.allowKeywordMatching) {
      allowKeywordMatching = true;
    }
  });

  return {
    applicableConstraints: Array.from(applicableSet) as Array<'colors' | 'sizes' | 'fabrics' | 'materials' | 'occasions' | 'seasons' | 'fit' | 'price'>,
    textOnlyConstraints: Array.from(textOnlySet),
    contextWordMappings: Object.keys(contextMappings).length > 0 ? contextMappings : undefined,
    fallbackStrategy,
    allowKeywordMatching,
  };
}

