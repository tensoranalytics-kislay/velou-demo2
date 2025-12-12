'use client';

import { useEffect, useState } from 'react';

type ProductClick = {
  id: string;
  title: string;
  priceCents: number;
  salePriceCents: number | null;
  currency: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  imageUrl: string;
  clickCount: number;
};

type FilterOptions = {
  categories: string[];
  subcategories: string[];
  brands: string[];
};

type ProductClicksResponse = {
  products: ProductClick[];
  totalProducts: number;
  totalClicks: number;
  filterOptions: FilterOptions;
};

type SortOption = 'clicks_desc' | 'clicks_asc' | 'title_asc' | 'title_desc' | 'price_asc' | 'price_desc';

export default function ProductClicksTable() {
  const [data, setData] = useState<ProductClicksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [category, setCategory] = useState<string>('');
  const [subcategory, setSubcategory] = useState<string>('');
  const [brand, setBrand] = useState<string>('');
  const [priceMin, setPriceMin] = useState<string>('');
  const [priceMax, setPriceMax] = useState<string>('');
  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'all'>('30d');
  const [sortBy, setSortBy] = useState<SortOption>('clicks_desc');

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (subcategory) params.set('subcategory', subcategory);
      if (brand) params.set('brand', brand);
      if (priceMin) params.set('priceMin', priceMin);
      if (priceMax) params.set('priceMax', priceMax);
      params.set('dateRange', dateRange);
      params.set('sortBy', sortBy);
      params.set('limit', '200');

      const response = await fetch(`/api/admin/metrics/product-clicks?${params.toString()}`, {
        credentials: 'include', // Include HttpOnly cookies
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load product clicks';
      setError(errorMessage);
      // Log error for debugging (client-side only)
      if (process.env.NODE_ENV === 'development') {
        console.error('[ProductClicksTable] Fetch error:', {
          message: errorMessage,
          error: err instanceof Error ? err.message : String(err),
          errorType: err instanceof Error ? err.constructor.name : typeof err,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [category, subcategory, brand, priceMin, priceMax, dateRange, sortBy]);

  const formatPrice = (priceCents: number, salePriceCents: number | null, currency: string) => {
    const displayPrice = salePriceCents || priceCents;
    const originalPrice = salePriceCents ? priceCents : null;
    const formatted = `${currency} ${(displayPrice / 100).toFixed(2)}`;
    if (originalPrice && salePriceCents) {
      return (
        <span>
          <span className="text-rose-600 font-semibold">{formatted}</span>
          <span className="text-slate-400 line-through ml-2">{currency} {(originalPrice / 100).toFixed(2)}</span>
        </span>
      );
    }
    return formatted;
  };

  const clearFilters = () => {
    setCategory('');
    setSubcategory('');
    setBrand('');
    setPriceMin('');
    setPriceMax('');
    setDateRange('30d');
    setSortBy('clicks_desc');
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900">Filters</h4>
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-rose-600 hover:text-rose-700 font-medium"
          >
            Clear all
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Date Range */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Date Range</label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as '7d' | '30d' | 'all')}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            >
              <option value="">All categories</option>
              {data?.filterOptions.categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Subcategory */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Subcategory</label>
            <select
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            >
              <option value="">All subcategories</option>
              {data?.filterOptions.subcategories.map((subcat) => (
                <option key={subcat} value={subcat}>
                  {subcat}
                </option>
              ))}
            </select>
          </div>

          {/* Brand */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Brand</label>
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            >
              <option value="">All brands</option>
              {data?.filterOptions.brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* Price Min */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Min Price ($)</label>
            <input
              type="number"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
              placeholder="0"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            />
          </div>

          {/* Price Max */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Max Price ($)</label>
            <input
              type="number"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
              placeholder="1000"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            />
          </div>

          {/* Sort By */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            >
              <option value="clicks_desc">Clicks (High to Low)</option>
              <option value="clicks_asc">Clicks (Low to High)</option>
              <option value="title_asc">Title (A-Z)</option>
              <option value="title_desc">Title (Z-A)</option>
              <option value="price_asc">Price (Low to High)</option>
              <option value="price_desc">Price (High to Low)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-xs font-medium text-slate-500">Total Products Clicked</dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-900">{data.totalProducts}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-xs font-medium text-slate-500">Total Clicks</dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-900">{data.totalClicks}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-xs font-medium text-slate-500">Showing</dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-900">
              {data.products.length} of {data.totalProducts}
            </dd>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
          <div className="flex items-center justify-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-rose-500 border-t-transparent"></div>
            <div className="text-sm text-slate-500">Loading product clicks...</div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-sm text-red-800">{error}</div>
        </div>
      )}

      {/* Products Table */}
      {!loading && !error && data && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Product
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Brand
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Clicks
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {data.products.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-500">
                      No products found with the selected filters.
                    </td>
                  </tr>
                ) : (
                  data.products.map((product) => (
                    <tr key={product.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={product.imageUrl}
                            alt={product.title}
                            className="h-12 w-12 rounded-md object-cover border border-slate-200"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${product.id}/100/100`;
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-900 truncate">{product.title}</div>
                            {product.subcategory && (
                              <div className="text-xs text-slate-500 truncate">{product.subcategory}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-900">{product.category}</td>
                      <td className="px-6 py-4 text-sm text-slate-900">{product.brand || '—'}</td>
                      <td className="px-6 py-4 text-sm text-slate-900">
                        {formatPrice(product.priceCents, product.salePriceCents, product.currency)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-sm font-semibold text-rose-800">
                            {product.clickCount}
                          </span>
                          <span className="text-xs text-slate-500">click{product.clickCount !== 1 ? 's' : ''}</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

