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
  useCases?: string[];
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

export type ProductAttributes = {
  fabric?: string;
  fit?: string;
  length?: string;
  pattern?: string;
  season?: string;
  occasion?: string;
  color?: string;
  useCases?: string[];
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

