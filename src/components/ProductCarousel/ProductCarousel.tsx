'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProductCard } from '@/lib/llm/orchestrator/cards';

type ProductCarouselProps = {
  products: ProductCard[];
  onProductClick?: (productId: string) => Promise<void> | void;
  onProductAsk?: (productId: string, productTitle: string, productImageUrl: string) => Promise<void> | void;
  onProductFindSimilar?: (productId: string, productTitle: string, productImageUrl: string) => Promise<void> | void;
};

const formatAttributes = (attributes: string[]) => {
  const filtered = attributes.filter(Boolean);
  const maxVisible = 4;
  if (filtered.length <= maxVisible) {
    return { visible: filtered, remaining: 0 };
  }
  return { visible: filtered.slice(0, maxVisible), remaining: filtered.length - maxVisible };
};

const truncateTitle = (title: string, maxWords = 8) => {
  const words = title.split(/\s+/);
  if (words.length <= maxWords) return title;
  return `${words.slice(0, maxWords).join(' ')}...`;
};

const formatCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);

const FALLBACK_CARD_WIDTH = 170;

// Helper to extract single word from attribute value for keyword tags
const getSingleWord = (attr: string): string => {
  const value = attr.split(':')[1]?.trim() || attr;
  // Replace underscores with spaces first (before any splitting)
  const normalizedValue = value.replace(/_/g, ' ');
  // Split by spaces/commas and take first meaningful word
  const words = normalizedValue.split(/[\s,]+/).filter(Boolean);
  const result = words[0] || normalizedValue;
  return result;
};

// Generate a deterministic rating between 1 and 5 based on product ID
const getRating = (productId: string): number => {
  // Use product ID to generate a consistent rating
  let hash = 0;
  for (let i = 0; i < productId.length; i++) {
    hash = productId.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Map to 1-5 range, with slight bias toward higher ratings (3-5)
  const normalized = Math.abs(hash) % 100;
  if (normalized < 10) return 1;
  if (normalized < 25) return 2;
  if (normalized < 50) return 3;
  if (normalized < 80) return 4;
  return 5;
};

export default function ProductCarousel({ products, onProductClick, onProductAsk, onProductFindSimilar }: ProductCarouselProps) {
  const [clickedProductId, setClickedProductId] = useState<string | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);


  const inStockProducts = useMemo(
    () => products.filter((product) => product.stockStatus !== 'out_of_stock'),
    [products],
  );

  const updateScrollState = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const tolerance = 4;
    setCanScrollLeft(container.scrollLeft > tolerance);
    setCanScrollRight(container.scrollLeft + container.clientWidth < container.scrollWidth - tolerance);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    updateScrollState();
    const handleScroll = () => updateScrollState();

    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [updateScrollState]);

  useEffect(() => {
    updateScrollState();
  }, [inStockProducts.length, updateScrollState]);

  const scrollByCard = useCallback(
    (direction: 'left' | 'right') => {
      const container = scrollRef.current;
      if (!container) return;

      const firstCard = container.querySelector('article');
      const cardWidth = firstCard ? firstCard.getBoundingClientRect().width : FALLBACK_CARD_WIDTH;

      const computed = window.getComputedStyle(container);
      const gap =
        parseFloat(computed.columnGap || computed.gap || '0') || parseFloat(computed.rowGap || '0') || 12;

      const delta = (cardWidth + gap) * (direction === 'left' ? -1 : 1);
      container.scrollBy({ left: delta, behavior: 'smooth' });
    },
    [],
  );


  if (inStockProducts.length === 0) {
    return null;
  }

  return (
    <div className="mt-4">
      <div className="relative overflow-visible">
        <div
          ref={scrollRef}
          className="flex items-stretch gap-3 overflow-x-auto overflow-y-visible pb-2 snap-x snap-mandatory scroll-smooth md:gap-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        >
        {inStockProducts.map((product) => {
          const { visible: visibleAttributes, remaining } = formatAttributes(product.keyAttributes);
          const hasSale =
            typeof product.salePriceCents === 'number' &&
            product.salePriceCents > 0 &&
            product.salePriceCents < product.priceCents;
          
          // Extract color attribute to combine with queryChips
          const colorAttribute = visibleAttributes.find(attr => attr.toLowerCase().startsWith('color:'));
          const otherAttributes = visibleAttributes.filter(attr => !attr.toLowerCase().startsWith('color:'));
          
          return (
            <article
              key={product.id}
                className="group relative flex w-[40vw] max-w-[40vw] flex-shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-[#D61F2B]/20 bg-[#FEEEED] p-2 text-slate-900 transition hover:border-[#D61F2B]/40 sm:w-[28vw] sm:max-w-[28vw] md:w-[170px] md:max-w-[170px] lg:w-[180px] lg:max-w-[180px]"
            >
                <div className="relative mb-2 w-full rounded-xl border border-white/60 bg-[#fff7f6] p-1.5 overflow-visible">
                  <div className="relative h-[140px] w-full rounded-xl bg-white/70 sm:h-[150px] md:h-[160px] overflow-visible">
                    <img
                      src={product.imageUrl}
                      alt={product.title}
                      className="h-full w-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${product.id}/400/600`;
                      }}
                    />
                    {/* Rating pill overlay */}
                    <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-white/90 backdrop-blur-sm px-1.5 py-0.5 shadow-sm">
                      <span className="text-[10px] font-semibold text-slate-700">{getRating(product.id).toFixed(1)}</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-2.5 w-2.5 text-amber-500 fill-amber-500"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </div>
                    {/* Ask about product icon - floating bottom left */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onProductAsk?.(product.id, product.title, product.imageUrl);
                      }}
                      className="absolute bottom-1.5 left-1.5 flex items-center justify-center rounded-full bg-rose-500/90 backdrop-blur-sm p-1.5 shadow-lg transition hover:bg-rose-600/90 hover:scale-110 active:scale-95"
                      aria-label={`Ask about ${product.title}`}
                      title={`Ask about ${product.title}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                        />
                      </svg>
                    </button>
                    {/* Find similar products icon - floating bottom right */}
                    {(() => {
                      // Debug logging for similar products button
                      if (!onProductFindSimilar) {
                        console.log('[ProductCarousel] Similar products button: onProductFindSimilar is undefined', {
                          productId: product.id,
                          productTitle: product.title?.substring(0, 50),
                        });
                      }
                      return null;
                    })()}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onProductFindSimilar) {
                          onProductFindSimilar(product.id, product.title, product.imageUrl);
                        } else {
                          console.warn('[ProductCarousel] Similar products button clicked but onProductFindSimilar is undefined', {
                            productId: product.id,
                            productTitle: product.title?.substring(0, 50),
                          });
                        }
                      }}
                      className="absolute bottom-1.5 right-1.5 flex items-center justify-center rounded-full bg-[#D61F2B] p-1.5 shadow-xl transition hover:bg-[#b91822] hover:scale-110 active:scale-95 z-30 pointer-events-auto"
                      aria-label={`Find similar products to ${product.title}`}
                      title={`Find similar products to ${product.title}`}
                      style={{ zIndex: 30 }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="flex flex-1 flex-col">
                <div className="space-y-0.5">
                    <h3 className="text-xs font-semibold text-slate-900 line-clamp-2 break-words leading-tight">
                    {product.title}
                  </h3>
                  <div className="flex items-baseline gap-1.5">
                    {hasSale ? (
                      <>
                        <span className="text-[10px] text-slate-500 line-through">
                          {formatCurrency(product.priceCents, product.currency)}
                        </span>
                        <span className="text-xs font-semibold text-[#D61F2B]">
                          {formatCurrency(product.salePriceCents!, product.currency)}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs font-semibold text-[#D61F2B]">
                        {formatCurrency(product.priceCents, product.currency)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Combined queryChips and color attribute */}
                {(product.queryChips && product.queryChips.length > 0) || colorAttribute ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {/* Query chips */}
                    {product.queryChips
                      ?.filter((chip) => chip.label.trim().length > 2)
                      .slice(0, 5)
                      .map((chip, idx) => (
                        <div key={`${product.id}-chip-${idx}`} className="relative">
                          <span className="peer inline-flex rounded-full border border-[#D61F2B]/30 bg-[#D61F2B]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#D61F2B] max-w-full truncate">
                            {chip.label.replace(/_/g, ' ')}
                          </span>
                          <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-[min(80vw,200px)] -translate-x-1/2 rounded-lg bg-neutral-900/90 px-3 py-2 text-left text-xs text-white opacity-0 shadow-lg transition peer-hover:opacity-100 peer-focus-visible:opacity-100">
                            {chip.why}
                          </span>
                        </div>
                      ))}
                    {/* Color attribute */}
                    {colorAttribute && (
                      <span className="rounded-full border border-[#D61F2B]/20 bg-white/70 px-1.5 py-0.5 text-[10px] text-slate-700 max-w-full truncate">
                        {getSingleWord(colorAttribute)}
                      </span>
                    )}
                  </div>
                ) : null}

                {/* Other attributes (non-color) */}
                {otherAttributes.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {otherAttributes.map((attribute) => (
                      <span
                        key={attribute}
                        className="rounded-full border border-[#D61F2B]/20 bg-white/70 px-1.5 py-0.5 text-[10px] text-slate-700 max-w-full truncate"
                      >
                        {getSingleWord(attribute)}
                      </span>
                    ))}
                    {remaining > 0 && (
                      <span className="rounded-full border border-[#D61F2B]/20 bg-white/70 px-1.5 py-0.5 text-[10px] text-slate-500">
                        +{remaining} more
                      </span>
                    )}
                  </div>
                )}

                  <div className="mt-auto pt-2">
                  <button
                    type="button"
                    disabled={clickedProductId === product.id}
                    onClick={async () => {
                      setClickedProductId(product.id);
                      await onProductClick?.(product.id);
                      window.open(product.productUrl, '_blank', 'noopener,noreferrer');
                    }}
                      className="w-full h-7 rounded-lg bg-[#D61F2B] px-2 py-1 text-xs font-semibold text-[#FEEEED] transition hover:bg-[#b91822] disabled:opacity-50 truncate cursor-pointer"
                  >
                    {clickedProductId === product.id ? '✓ Clicked' : 'View product'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        </div>

        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-1 pr-3 z-30">
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => scrollByCard('left')}
            disabled={!canScrollLeft}
            className="pointer-events-auto hidden rounded-full bg-white/90 p-2 text-[#D61F2B] shadow-lg transition hover:bg-white disabled:opacity-40 sm:block cursor-pointer"
          >
            <span className="sr-only">Scroll left</span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pl-3 pr-1 z-30">
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => scrollByCard('right')}
            disabled={!canScrollRight}
            className="pointer-events-auto hidden rounded-full bg-white/90 p-2 text-[#D61F2B] shadow-lg transition hover:bg-white disabled:opacity-40 sm:block cursor-pointer"
          >
            <span className="sr-only">Scroll right</span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        {/* Left edge gradient overlay - appears when scrolled right, fades at left edge */}
        <div
          className={`pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-white to-transparent z-10 transition-opacity duration-300 ${
            canScrollLeft ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {/* Right edge gradient overlay - fades when scrolled to right edge */}
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white to-transparent z-10 transition-opacity duration-300 ${
            canScrollRight ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>
    </div>
  );
}

