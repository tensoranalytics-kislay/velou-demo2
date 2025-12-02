import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient, Prisma, StockStatus } from '@prisma/client';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

const DEFAULT_CSV_PATH = '/mnt/data/products_2025-11-20_10:52:20.csv';
const FALLBACK_CSV_PATH = path.resolve(process.cwd(), 'products_2025-11-20_10:52:20.csv');
const BATCH_SIZE = 500;

type CsvRow = {
  title?: string;
  price?: string;
  sale_price?: string;
  condition?: string;
  availability?: string;
  age_group?: string;
  brand?: string;
  color?: string;
  custom_label_4?: string;
  description?: string;
  gender?: string;
  google_product_category?: string;
  image_link?: string;
  link?: string;
  material?: string;
  product_type?: string;
  size?: string;
  inventory?: string;
  item_group_id?: string;
};

type ParsedPrice = {
  cents: number;
  currency: string;
};

const resolveCsvPath = () => {
  if (fs.existsSync(DEFAULT_CSV_PATH)) {
    return DEFAULT_CSV_PATH;
  }
  if (fs.existsSync(FALLBACK_CSV_PATH)) {
    console.warn(
      `[catalog] CSV not found at ${DEFAULT_CSV_PATH}. Falling back to ${FALLBACK_CSV_PATH}`,
    );
    return FALLBACK_CSV_PATH;
  }
  throw new Error(
    `CSV file not found. Expected at ${DEFAULT_CSV_PATH} (or ${FALLBACK_CSV_PATH} as a fallback)`,
  );
};

const clean = (value?: string) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const parsePrice = (raw?: string): ParsedPrice | null => {
  if (!raw) return null;
  const normalized = raw.replace(/,/g, '').trim();
  if (!normalized) return null;
  const numberMatch = normalized.match(/(\d+(\.\d+)?)/);
  if (!numberMatch) return null;
  const amount = Number.parseFloat(numberMatch[1]);
  if (Number.isNaN(amount)) return null;
  const currencyMatch = normalized.match(/([A-Za-z]{3})/);
  const currency = currencyMatch ? currencyMatch[1].toUpperCase() : 'USD';
  return { cents: Math.round(amount * 100), currency };
};

const parseInventory = (raw?: string) => {
  if (!raw) return undefined;
  const normalized = raw.replace(/[^\d.-]/g, '');
  if (!normalized) return undefined;
  const value = Number.parseInt(normalized, 10);
  return Number.isNaN(value) ? undefined : value;
};

const determineStockStatus = (availability?: string, inventory?: number): StockStatus => {
  const normalized = availability?.toLowerCase();
  if (normalized === 'out of stock') {
    return 'out_of_stock';
  }
  if (normalized === 'in stock') {
    if (typeof inventory === 'number' && inventory > 0 && inventory < 5) {
      return 'low_stock';
    }
    return 'in_stock';
  }
  return 'in_stock';
};

const deriveCategory = (googleCategory?: string, productType?: string): string => {
  const parseHierarchy = (value?: string) => {
    if (!value) return undefined;
    const segments = value
      .split('>')
      .map((segment) => segment.trim())
      .filter(Boolean);
    return segments[segments.length - 1];
  };

  const byGoogle = parseHierarchy(googleCategory);
  if (byGoogle) return byGoogle;

  const byProductType = parseHierarchy(productType);
  if (byProductType) return byProductType;

  return 'Apparel';
};

const deriveSubcategory = (customLabel?: string, productType?: string, fallback?: string) => {
  if (customLabel && customLabel.trim().length) {
    return customLabel.trim();
  }
  if (productType) {
    const segments = productType
      .split('>')
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (segments.length) {
      return segments[segments.length - 1];
    }
  }
  return fallback;
};

const createProductId = (productUrl: string) => {
  const hash = createHash('sha256').update(productUrl).digest('hex').slice(0, 24);
  return `prd_${hash}`;
};

const normalizeGender = (gender?: string): string | undefined => {
  if (!gender) return undefined;
  const normalized = gender.toLowerCase().trim();
  // Map CSV values to our canonical values
  if (normalized === 'male' || normalized === 'men' || normalized === "men's") {
    return 'mens';
  }
  if (normalized === 'female' || normalized === 'women' || normalized === "women's") {
    return 'womens';
  }
  if (normalized === 'unisex' || normalized === 'gender neutral' || normalized === 'all genders') {
    return 'unisex';
  }
  // If already in canonical form, return as-is
  if (normalized === 'mens' || normalized === 'womens' || normalized === 'unisex') {
    return normalized;
  }
  return undefined;
};

const buildAttributes = (row: CsvRow): Prisma.InputJsonValue => {
  const attributes: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    attributes[key] = value;
  };

  set('condition', clean(row.condition));
  set('availability', clean(row.availability));
  set('ageGroup', clean(row.age_group));
  set('brand', clean(row.brand));
  set('color', clean(row.color));
  set('customLabel4', clean(row.custom_label_4));
  set('description', clean(row.description));
  set('gender', normalizeGender(row.gender));
  set('googleProductCategory', clean(row.google_product_category));
  set('imageLink', clean(row.image_link));
  set('inventory', parseInventory(row.inventory));
  set('itemGroupId', clean(row.item_group_id));
  set('material', clean(row.material));
  set('productType', clean(row.product_type));
  set('size', clean(row.size));
  set('price', clean(row.price));
  set('salePrice', clean(row.sale_price));

  return attributes as Prisma.InputJsonValue;
};

const transformRow = (row: CsvRow): Prisma.ProductCreateManyInput | null => {
  const title = clean(row.title);
  const priceInfo = parsePrice(row.price);
  const productUrl = clean(row.link);
  const imageUrl = clean(row.image_link);

  if (!title || !priceInfo || !productUrl || !imageUrl) {
    return null;
  }

  const salePriceInfo = parsePrice(row.sale_price ?? undefined);
  const inventory = parseInventory(row.inventory);
  const stockStatus = determineStockStatus(row.availability, inventory);
  const category = deriveCategory(row.google_product_category, row.product_type);
  const subcategory = deriveSubcategory(row.custom_label_4, row.product_type, category);

  return {
    id: createProductId(productUrl),
    title,
    description: clean(row.description) ?? title,
    imageUrl,
    productUrl,
    priceCents: priceInfo.cents,
    salePriceCents: salePriceInfo?.cents ?? undefined,
    currency: priceInfo.currency,
    category,
    subcategory,
    brand: clean(row.brand),
    attributes: buildAttributes(row),
    stockStatus,
    // Prisma will auto-generate createdAt and updatedAt, but createMany requires them
    createdAt: new Date(),
    updatedAt: new Date(),
  };
};

async function importCatalog() {
  const csvPath = resolveCsvPath();
  console.log(`📄  Loading catalog CSV from ${csvPath}`);
  const fileContent = await fs.promises.readFile(csvPath, 'utf-8');
  const records = parse(fileContent, {
    columns: (header) =>
      header.map((name: string) => name.trim().toLowerCase().replace(/\s+/g, '_')),
    skip_empty_lines: true,
  }) as CsvRow[];

  console.log(`🧮  Parsed ${records.length} raw rows...`);

  const products: Prisma.ProductCreateManyInput[] = [];
  let skipped = 0;

  for (const row of records) {
    const product = transformRow(row);
    if (product) {
      products.push(product);
    } else {
      skipped += 1;
    }
  }

  if (!products.length) {
    throw new Error('No valid products found in CSV.');
  }

  console.log(`✅  Prepared ${products.length} products (${skipped} skipped).`);
  console.log('🧹  Clearing existing products...');
  await prisma.product.deleteMany();

  console.log('⬆️  Inserting products in batches...');
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    await prisma.product.createMany({
      data: batch,
      skipDuplicates: true,
    });
    console.log(
      `   • Inserted ${Math.min(i + batch.length, products.length)} / ${products.length}`,
    );
  }

  console.log('🎉  Catalog import complete.');
}

importCatalog()
  .catch((error) => {
    console.error('❌  Catalog import failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

