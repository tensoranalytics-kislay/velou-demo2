import { prisma } from '../db';

const ONTOLOGY_LIMIT = 80;
const ATTRIBUTE_SAMPLE_LIMIT = 400;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type CatalogOntology = {
  categories: string[];
  productTypes: string[];
  brands: string[];
  colors: string[];
  materials: string[];
  genders: string[];
  sizes: string[];
  googleCategories: string[];
  customLabels4: string[];
};

type CacheEntry = {
  expiresAt: number;
  data: CatalogOntology;
};

let cache: CacheEntry | null = null;

const normalizeValue = (value?: string | null) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed.toLowerCase() : undefined;
};

const collectDistinct = async (field: 'category' | 'brand') => {
  const rows = await prisma.product.findMany({
    distinct: [field],
    select: { [field]: true } as const,
    take: ONTOLOGY_LIMIT,
  });
  const values = rows
    .map((row) => normalizeValue(row[field as keyof typeof row] as string | null))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(values));
};

const collectAttributeValues = async () => {
  const samples = await prisma.product.findMany({
    select: {
      attributes: true,
    },
    take: ATTRIBUTE_SAMPLE_LIMIT,
    orderBy: {
      createdAt: 'desc',
    },
  });

  const sets = {
    productTypes: new Set<string>(),
    colors: new Set<string>(),
    materials: new Set<string>(),
    genders: new Set<string>(),
    sizes: new Set<string>(),
    googleCategories: new Set<string>(),
    customLabels4: new Set<string>(),
  };

  const addValue = (set: Set<string>, value?: string | null) => {
    const normalized = normalizeValue(value);
    if (normalized) {
      set.add(normalized);
    }
  };

  const addArray = (set: Set<string>, values?: unknown) => {
    if (!Array.isArray(values)) return;
    for (const value of values) {
      if (typeof value === 'string') {
        addValue(set, value);
      }
    }
  };

  for (const sample of samples) {
    const attrs = (sample.attributes ?? {}) as Record<string, unknown>;
    addValue(sets.productTypes, attrs.productType as string | undefined);
    addValue(sets.materials, (attrs.material as string) ?? (attrs.fabric as string));
    addValue(sets.colors, attrs.color as string | undefined);
    addValue(sets.genders, attrs.gender as string | undefined);
    addValue(sets.googleCategories, attrs.googleProductCategory as string | undefined);
    addValue(sets.customLabels4, attrs.customLabel4 as string | undefined);
    addArray(sets.sizes, attrs.sizes);
  }

  return {
    productTypes: Array.from(sets.productTypes),
    colors: Array.from(sets.colors),
    materials: Array.from(sets.materials),
    genders: Array.from(sets.genders),
    sizes: Array.from(sets.sizes),
    googleCategories: Array.from(sets.googleCategories),
    customLabels4: Array.from(sets.customLabels4),
  };
};

export async function getCatalogOntology(): Promise<CatalogOntology> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.data;
  }

  const [categories, brands, attributeValues] = await Promise.all([
    collectDistinct('category'),
    collectDistinct('brand'),
    collectAttributeValues(),
  ]);

  const ontology: CatalogOntology = {
    categories,
    productTypes: attributeValues.productTypes,
    brands,
    colors: attributeValues.colors,
    materials: attributeValues.materials,
    genders: attributeValues.genders,
    sizes: attributeValues.sizes,
    googleCategories: attributeValues.googleCategories,
    customLabels4: attributeValues.customLabels4,
  };

  cache = {
    data: ontology,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return ontology;
}

