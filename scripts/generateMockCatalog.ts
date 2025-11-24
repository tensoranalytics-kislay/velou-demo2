import { randomUUID } from 'node:crypto';
import { PrismaClient, StockStatus } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORY_CONFIG = {
  Dresses: { price: [12000, 32000], lengths: ['mini', 'midi', 'maxi'] },
  Tops: { price: [6000, 18000], lengths: ['waist-length', 'hip-length'] },
  Pants: { price: [9000, 22000], lengths: ['ankle-length', 'full-length'] },
  Outerwear: { price: [15000, 35000], lengths: ['hip-length', 'knee-length'] },
  Skirts: { price: [7000, 20000], lengths: ['mini', 'midi', 'maxi'] },
} as const;

const FABRICS = ['cotton', 'linen', 'silk', 'polyester blend', 'wool blend'];
const FITS = ['regular', 'slim', 'relaxed', 'oversized', 'bodycon'];
const PATTERNS = ['solid', 'floral', 'striped', 'checked', 'abstract'];
const SEASONS = ['summer', 'winter', 'spring', 'autumn', 'all-season'];
const OCCASIONS = ['beach wedding', 'office', 'casual weekend', 'formal event', 'date night'];
const COLORS = ['black', 'white', 'navy', 'pastel pink', 'sage', 'beige', 'bright red'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const BRANDS = ['Velou Atelier', 'Maison Windward', 'Studio Aurelia', 'Linea Coast', 'North & Nova'];
const CARE = ['machine wash cold', 'hand wash', 'dry clean only'];

const STOCK_WEIGHTS: Record<StockStatus, number> = {
  in_stock: 0.75,
  low_stock: 0.15,
  out_of_stock: 0.1,
};

const rand = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];

const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const pickSizes = () => {
  const count = randInt(2, SIZES.length);
  const shuffled = [...SIZES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).sort((a, b) => SIZES.indexOf(a) - SIZES.indexOf(b));
};

const pickStockStatus = (): StockStatus => {
  const roll = Math.random();
  let cumulative = 0;
  for (const [status, weight] of Object.entries(STOCK_WEIGHTS) as [StockStatus, number][]) {
    cumulative += weight;
    if (roll <= cumulative) return status;
  }
  return 'in_stock';
};

const buildDescription = (category: string, fabric: string, occasion: string, season: string) =>
  `Designed for ${occasion} moments, this ${fabric} ${category.toLowerCase()} keeps things polished yet effortless. Balanced proportions, thoughtful detailing, and season-ready construction make it a reliable go-to for ${season} styling.`;

const singularCategory = (category: keyof typeof CATEGORY_CONFIG): string => {
  switch (category) {
    case 'Dresses':
      return 'Dress';
    case 'Tops':
      return 'Top';
    case 'Pants':
      return 'Trouser';
    case 'Outerwear':
      return 'Jacket';
    case 'Skirts':
      return 'Skirt';
    default:
      return String(category).slice(0, -1);
  }
};

const buildProduct = (index: number) => {
  const category = rand(Object.keys(CATEGORY_CONFIG) as Array<keyof typeof CATEGORY_CONFIG>);
  const { price } = CATEGORY_CONFIG[category];
  const length = rand(CATEGORY_CONFIG[category].lengths);
  const fabric = rand(FABRICS);
  const fit = rand(FITS);
  const pattern = rand(PATTERNS);
  const season = rand(SEASONS);
  const occasion = rand(OCCASIONS);
  const color = rand(COLORS);
  const brand = rand(BRANDS);
  const care = rand(CARE);
  const stockStatus = pickStockStatus();
  const priceCents = randInt(price[0], price[1]);
  const id = `prd_${index}_${randomUUID()}`;
  const singular = singularCategory(category);
  const title = `${color.replace(/^\w/, (c) => c.toUpperCase())} ${fabric} ${singular}`;

  const salePriceCents = Math.random() < 0.35 ? Math.max(priceCents - randInt(500, 3000), 0) : undefined;

  return {
    id,
    title,
    description: buildDescription(category, fabric, occasion, season),
    imageUrl: `https://picsum.photos/seed/${id}/600/800`,
    productUrl: `https://demo.velou.app/products/${id}`,
    priceCents,
    salePriceCents,
    currency: 'USD',
    category,
    subcategory: `${length} ${singular}`,
    brand,
    stockStatus,
    attributes: {
      fabric,
      fit,
      length,
      pattern,
      season,
      occasion,
      useCases: [occasion, `${season} events`],
      color,
      sizes: pickSizes(),
      care,
    },
  };
};

export async function generateMockCatalog(count = 240) {
  console.log('🌱  Seeding mock apparel catalog...');
  await prisma.product.deleteMany();
  const products = Array.from({ length: count }, (_, idx) => buildProduct(idx));
  await prisma.product.createMany({ data: products });
  console.log(`✅  Inserted ${products.length} products.`);
}

generateMockCatalog()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

