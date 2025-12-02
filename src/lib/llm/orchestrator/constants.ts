export const COLOR_KEYWORDS = [
  'black',
  'white',
  'navy',
  'pastel pink',
  'sage',
  'beige',
  'bright red',
  'red',
  'blue',
  'green',
  'yellow',
  'pink',
  'purple',
  'brown',
  'gray',
  'grey',
  'ivory',
];

export const SIZE_KEYWORDS = ['xs', 's', 'm', 'l', 'xl'];

export const FABRIC_KEYWORDS = ['linen', 'cotton', 'silk', 'wool', 'polyester', 'polyester blend', 'wool blend'];

export const MATERIAL_KEYWORDS: Record<string, string> = {
  linen: 'linen',
  cotton: 'cotton',
  silk: 'silk',
  wool: 'wool',
  denim: 'denim',
  leather: 'leather',
  polyester: 'polyester',
  rayon: 'rayon',
  cashmere: 'cashmere',
  modal: 'modal',
  viscose: 'viscose',
};

export const GENDER_KEYWORDS: Record<string, string> = {
  men: 'male',
  "men's": 'male',
  mens: 'male',
  male: 'male',
  guys: 'male',
  women: 'female',
  womens: 'female',
  "women's": 'female',
  female: 'female',
  girls: 'female',
  unisex: 'unisex',
};

export const SEASON_KEYWORDS: Record<string, string> = {
  summer: 'summer',
  winter: 'winter',
  spring: 'spring',
  autumn: 'autumn',
  fall: 'autumn',
};

export const OCCASION_KEYWORDS: Record<string, string> = {
  wedding: 'beach wedding',
  'beach wedding': 'beach wedding',
  office: 'office',
  work: 'office',
  casual: 'casual weekend',
  weekend: 'casual weekend',
  formal: 'formal event',
  date: 'date night',
};

export const CATEGORY_KEYWORDS: Record<string, string> = {
  dress: 'Dresses',
  dresses: 'Dresses',
  gown: 'Dresses',
  top: 'Tops',
  blouse: 'Tops',
  shirt: 'Tops',
  pant: 'Pants',
  pants: 'Pants',
  trouser: 'Pants',
  trousers: 'Pants',
  skirt: 'Skirts',
  skirts: 'Skirts',
  coat: 'Outerwear',
  jacket: 'Outerwear',
  outerwear: 'Outerwear',
};

export const FIT_KEYWORDS = ['relaxed', 'slim', 'oversized', 'regular', 'bodycon', 'tailored'];

export const PDP_KEYWORDS = ['right for', 'good for', 'work for', 'suitable', 'okay for'];

export const MAX_RECOMMENDATIONS = 4;

export const DISCOVERY_CANDIDATE_MULTIPLIER = 3;

export const PRODUCT_REQUEST_KEYWORDS = [
  'show me',
  'recommend',
  'suggest',
  'find',
  'looking for',
  'options',
  'ideas',
  'what should i wear',
  'pull together',
];

export const AFFIRMATIVE_KEYWORDS = [
  'yes',
  'yeah',
  'yep',
  'sure',
  'ok',
  'okay',
  'please',
  'show me',
  'show them',
  'show it',
  'go ahead',
  'send them',
  'sounds good',
  'let me see',
];

export const NEW_QUERY_KEYWORDS = [
  'looking for',
  'find me',
  'instead',
  'another',
  'different',
  'something else',
  'new query',
  'no',
  'nah',
  'rather',
  'prefer',
  'change',
  'swap',
  'need',
  'want',
  'dress',
  'top',
  'pants',
  'coat',
  'jacket',
  'skirt',
  'shoe',
  'boot',
  'sandal',
  'color',
  'size',
  'fabric',
  'linen',
  'cotton',
  'silk',
  'budget',
  'under',
  'between',
  'price',
  'occasion',
  'wedding',
  'office',
  'casual',
];

export const REFINEMENT_PREFIXES = [
  'make it',
  'only',
  'more',
  'less',
  'cheaper',
  'under',
  'maxi',
  'midi',
  'mini',
  'longer',
  'shorter',
  'not',
  'remove',
];

export const COMPARATIVE_KEYWORDS = ['instead', 'rather', 'but', 'also'];

export const CLARIFYING_REPLY =
  "Got it—let me help you find the right products.\n\nTo narrow things down, what type of product, main goal, and rough budget do you have in mind?";

export const PRICE_REGEX = /(under|below|less than)\s*\$?\s*(\d+)/i;

export const PRICE_RANGE_REGEX = /between\s*\$?\s*(\d+)\s*(and|-)\s*\$?\s*(\d+)/i;

