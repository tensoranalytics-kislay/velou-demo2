import Link from 'next/link';
import { prisma } from '@/lib/db';
import type { Product } from '@prisma/client';

const FALLBACK_IMAGE = 'https://picsum.photos/seed/product/600/800';

const formatCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);

export default async function ProductGrid() {
  let products: Product[] = [];
  let brandName = 'our store';
  
  // Fetch brand name from database
  try {
    const brandConfig = await prisma.brandConfig.findUnique({
      where: { id: 1 },
      select: { brandName: true },
    });
    if (brandConfig?.brandName) {
      brandName = brandConfig.brandName;
    }
  } catch (error) {
    // Use default if brand config fetch fails
  }
  
  try {
    products = await prisma.product.findMany({
      where: {
        stockStatus: {
          not: 'out_of_stock',
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 12,
    });
  } catch (error) {
    // Gracefully handle database connection errors
    // Log error in development but don't break the page
    if (process.env.NODE_ENV === 'development') {
      console.error('Failed to fetch products:', error instanceof Error ? error.message : String(error));
    }
    // Return empty array so the page still renders with the "No products found" message
    products = [];
  }

  return (
    <section className="mx-auto max-w-7xl px-4 pb-24 pt-12 md:px-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-rose-300">Catalog preview</p>
          <h3 className="mt-2 text-2xl font-semibold text-slate-900 md:text-3xl">Featured arrivals</h3>
        </div>
        <Link
          href="#"
          className="hidden rounded-full border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-500 transition hover:border-rose-300 hover:text-rose-600 sm:inline-flex"
        >
          View all
        </Link>
      </div>
      {products.length === 0 ? (
        <p className="mt-12 rounded-2xl border border-dashed border-rose-200 bg-white p-8 text-center text-sm text-slate-500">
          No products found yet. Once the catalog syncs, {brandName} arrivals will appear here automatically.
        </p>
      ) : (
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {products.map((product) => {
            const hasSale =
              typeof product.salePriceCents === 'number' &&
              product.salePriceCents > 0 &&
              product.salePriceCents < product.priceCents;
            const primaryPrice = hasSale ? product.salePriceCents! : product.priceCents;
            const secondaryPrice = hasSale ? product.priceCents : undefined;
            const imageSrc = product.imageUrl || FALLBACK_IMAGE;
            return (
          <article
            key={product.id}
                className="group flex flex-col overflow-hidden rounded-3xl border border-rose-100 bg-white text-slate-900 shadow-sm transition hover:-translate-y-1 hover:border-rose-200 hover:shadow-lg"
          >
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-rose-50">
              <img
                    src={imageSrc}
                    alt={product.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
              />
            </div>
                <div className="flex flex-1 flex-col px-4 py-5">
                  <p className="text-xs uppercase tracking-[0.4em] text-rose-300">{brandName}</p>
                  <h4 className="mt-2 text-sm font-medium text-slate-900 line-clamp-2">{product.title}</h4>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-base font-semibold text-rose-500">
                      {formatCurrency(primaryPrice, product.currency)}
                    </span>
                    {secondaryPrice && (
                      <span className="text-xs text-slate-400 line-through">
                        {formatCurrency(secondaryPrice, product.currency)}
                      </span>
                    )}
                  </div>
            </div>
          </article>
            );
          })}
      </div>
      )}
    </section>
  );
}

