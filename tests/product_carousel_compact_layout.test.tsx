/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import ProductCarousel from '../src/components/ProductCarousel/ProductCarousel';
import type { ProductCard } from '../src/lib/llm/orchestrator';

// Mock window.open
beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.open = vi.fn();
  }
});

// Mock product data
const mockProducts: ProductCard[] = [
  {
    id: '1',
    title: 'Test Product One',
    priceCents: 5000,
    currency: 'USD',
    keyAttributes: ['fabric: cotton', 'fit: relaxed'],
    reason: 'Chosen because it matches your style',
    imageUrl: 'https://example.com/image1.jpg',
    productUrl: 'https://example.com/product1',
    stockStatus: 'in_stock',
    queryChips: [{ label: 'Casual', why: 'Perfect for everyday wear' }],
  },
  {
    id: '2',
    title: 'Test Product Two',
    priceCents: 7500,
    salePriceCents: 6000,
    currency: 'USD',
    keyAttributes: ['fabric: denim', 'fit: slim'],
    reason: 'Great fit and quality',
    imageUrl: 'https://example.com/image2.jpg',
    productUrl: 'https://example.com/product2',
    stockStatus: 'in_stock',
  },
  {
    id: '3',
    title: 'Test Product Three',
    priceCents: 10000,
    currency: 'USD',
    keyAttributes: ['fabric: linen'],
    reason: 'Comfortable and stylish',
    imageUrl: 'https://example.com/image3.jpg',
    productUrl: 'https://example.com/product3',
    stockStatus: 'in_stock',
  },
];

describe('ProductCarousel - Compact Layout Tests', () => {
  describe('T1: Carousel layout - horizontal multi-card view', () => {
    it('should render cards in a horizontal scroll row with overflow-x-auto', () => {
      const { container } = render(<ProductCarousel products={mockProducts} />);
      
      // Find the scroll container
      const scrollContainer = container.querySelector('[class*="overflow-x-auto"]');
      expect(scrollContainer).toBeTruthy();
      
      // Should have flex row layout
      const hasFlexRow = scrollContainer?.classList.contains('flex');
      expect(hasFlexRow).toBe(true);
    });

    it('should have cards with fixed min-width so multiple appear in viewport', () => {
      const { container } = render(<ProductCarousel products={mockProducts} />);
      
      const cards = container.querySelectorAll('article');
      expect(cards.length).toBeGreaterThan(0);
      
      // Check that cards have width constraints (min-w or w- classes)
      // Current implementation uses w-[320px] sm:w-[360px] md:w-[380px]
      // After compact: should use min-w-[70vw] mobile, min-w-[220px] desktop
      const firstCard = cards[0];
      const cardClasses = firstCard.className;
      
      // Should have width/min-width classes
      const hasWidthConstraint = 
        cardClasses.includes('min-w-') || 
        cardClasses.includes('w-[') ||
        cardClasses.includes('w-');
      expect(hasWidthConstraint).toBe(true);
    });

    it('should have scroll-snap enabled for smooth card-by-card scrolling', () => {
      const { container } = render(<ProductCarousel products={mockProducts} />);
      
      const scrollContainer = container.querySelector('[class*="overflow-x-auto"]');
      const hasSnap = scrollContainer?.classList.contains('snap-x') || 
                      scrollContainer?.classList.contains('snap-mandatory');
      expect(hasSnap).toBe(true);
      
      // Cards should have snap-start
      const cards = container.querySelectorAll('article');
      if (cards.length > 0) {
        const firstCardClasses = cards[0].className;
        const hasSnapStart = firstCardClasses.includes('snap-start');
        expect(hasSnapStart).toBe(true);
      }
    });
  });

  describe('T2: Card compactness - reduced footprint', () => {
    it('should have reduced card width compared to baseline (target: ~40-55% smaller)', () => {
      const { container } = render(<ProductCarousel products={mockProducts} />);
      
      const cards = container.querySelectorAll('article');
      if (cards.length === 0) return;
      
      const firstCard = cards[0] as HTMLElement;
      const cardClasses = firstCard.className;
      
      // Current: w-[320px] sm:w-[360px] md:w-[380px]
      // Target compact: fixed w-[45vw] mobile, w-[200-220px] desktop (ensures 2+ cards visible)
      // Using fixed width instead of min-width to prevent expansion
      const hasCompactWidth = 
        cardClasses.includes('w-[45vw]') ||
        cardClasses.includes('w-[32vw]') ||
        cardClasses.includes('w-[200px]') ||
        cardClasses.includes('w-[220px]');
      
      // This should fail initially, then pass after implementation
      expect(hasCompactWidth).toBe(true);
    });

    it('should have reduced padding (target: p-3 or ~10-12px equivalent)', () => {
      const { container } = render(<ProductCarousel products={mockProducts} />);
      
      const cards = container.querySelectorAll('article');
      if (cards.length === 0) return;
      
      const firstCard = cards[0];
      const cardClasses = firstCard.className;
      
      // Current: p-5 (20px)
      // Target: p-3 (12px) or similar
      const hasCompactPadding = 
        cardClasses.includes('p-3') ||
        cardClasses.includes('p-2.5') ||
        cardClasses.includes('px-3');
      
      // This should fail initially, then pass after implementation
      expect(hasCompactPadding).toBe(true);
    });
  });

  describe('T3: Content scaling - typography and spacing', () => {
    it('should have title with line-clamp-2 and reduced font size (text-sm or text-[13-14px])', () => {
      const { container } = render(<ProductCarousel products={mockProducts} />);
      
      const titles = container.querySelectorAll('h3');
      if (titles.length === 0) return;
      
      const firstTitle = titles[0];
      const titleClasses = firstTitle.className;
      
      // Current: text-base (16px)
      // Target: text-sm (14px) or text-[13px] or text-[14px]
      const hasCompactTitle = 
        titleClasses.includes('text-sm') ||
        titleClasses.includes('text-[13px]') ||
        titleClasses.includes('text-[14px]');
      
      // Should have line-clamp-2
      const hasLineClamp = titleClasses.includes('line-clamp-2');
      
      // This should fail initially, then pass after implementation
      expect(hasCompactTitle).toBe(true);
      expect(hasLineClamp).toBe(true);
    });

    it('should have price with reduced font size (text-sm for sale, text-xs for strike-through)', () => {
      const { container } = render(<ProductCarousel products={mockProducts} />);
      
      // Find price elements
      const priceElements = container.querySelectorAll('[class*="text-"]');
      let foundSalePrice = false;
      let foundStrikePrice = false;
      
      priceElements.forEach((el) => {
        const classes = el.className;
        if (classes.includes('line-through')) {
          // Strike-through price should be text-xs
          foundStrikePrice = classes.includes('text-xs');
        } else if (el.textContent?.includes('$')) {
          // Sale price should be text-sm
          foundSalePrice = classes.includes('text-sm');
        }
      });
      
      // This should fail initially if sale price exists but isn't text-sm
      if (mockProducts.some(p => p.salePriceCents)) {
        expect(foundSalePrice || foundStrikePrice).toBe(true);
      }
    });

    it('should have chips with smaller sizing (text-[11-12px], px-2 py-0.5)', () => {
      const { container } = render(<ProductCarousel products={mockProducts} />);
      
      // Find chip elements (queryChips)
      const chips = container.querySelectorAll('[class*="rounded-full"]');
      if (chips.length === 0) return;
      
      let foundCompactChip = false;
      chips.forEach((chip) => {
        const classes = chip.className;
        // Should have text-[11px] or text-[12px] and px-2 py-0.5
        const hasCompactChip = 
          (classes.includes('text-[11px]') || classes.includes('text-[12px]')) &&
          (classes.includes('px-2') || classes.includes('px-1.5')) &&
          (classes.includes('py-0.5') || classes.includes('py-1'));
        
        if (hasCompactChip) foundCompactChip = true;
      });
      
      // This should fail initially, then pass after implementation
      expect(foundCompactChip).toBe(true);
    });

    it('should have compact CTA button (h-8 px-2 text-xs instead of full-width large)', () => {
      const { container } = render(<ProductCarousel products={mockProducts} />);
      
      const buttons = container.querySelectorAll('button[type="button"]');
      const ctaButtons = Array.from(buttons).filter(btn => 
        btn.textContent?.includes('View product') || btn.textContent?.includes('Clicked')
      );
      
      if (ctaButtons.length === 0) return;
      
      const firstButton = ctaButtons[0];
      const buttonClasses = firstButton.className;
      
      // Current: w-full py-2.5 text-sm
      // Target: h-8 px-2 text-xs (more compact)
      const hasCompactButton = 
        (buttonClasses.includes('h-8') || buttonClasses.includes('h-7')) &&
        (buttonClasses.includes('text-xs') || buttonClasses.includes('text-sm'));
      
      // This should fail initially, then pass after implementation
      expect(hasCompactButton).toBe(true);
    });

    it('should have reduced image height (target: smaller aspect ratio, ~40-55% reduction)', () => {
      const { container } = render(<ProductCarousel products={mockProducts} />);
      
      const imageContainers = container.querySelectorAll('[class*="h-["]');
      if (imageContainers.length === 0) return;
      
      const firstImageContainer = imageContainers[0];
      const containerClasses = firstImageContainer.className;
      
      // Current: h-[260px]
      // Target: h-[140px] to h-[160px] (roughly 40-45% reduction)
      const hasCompactImage = 
        containerClasses.includes('h-[140px]') ||
        containerClasses.includes('h-[150px]') ||
        containerClasses.includes('h-[160px]') ||
        containerClasses.includes('aspect-');
      
      // This should fail initially, then pass after implementation
      expect(hasCompactImage).toBe(true);
    });
  });

  describe('T4: Carousel gap and spacing', () => {
    it('should have tighter gap between cards (target: gap-3 or gap-4, ~12-16px)', () => {
      const { container } = render(<ProductCarousel products={mockProducts} />);
      
      const scrollContainer = container.querySelector('[class*="overflow-x-auto"]');
      if (!scrollContainer) return;
      
      const containerClasses = scrollContainer.className;
      
      // Current: gap-6 (24px)
      // Target: gap-3 (12px) or gap-4 (16px)
      const hasTightGap = 
        containerClasses.includes('gap-3') ||
        containerClasses.includes('gap-4');
      
      // This should fail initially, then pass after implementation
      expect(hasTightGap).toBe(true);
    });
  });
});

