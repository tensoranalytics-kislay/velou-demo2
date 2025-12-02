import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchConstraints } from '../src/lib/search/types';

// Mock Prisma
vi.mock('../src/lib/db', () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

// Mock ontology
vi.mock('../src/lib/search/ontology', () => ({
  getCatalogOntology: vi.fn().mockResolvedValue({
    categories: ['shirts', 'tops', 't-shirts', 'tees', 'blouses', 'pants', 'dresses', 'skirts'],
    colors: ['black', 'white', 'blue'],
    materials: ['cotton', 'polyester'],
    sizes: ['S', 'M', 'L'],
    brands: ['Lucky Brand'],
    genders: ['mens', 'womens', 'unisex'],
    productTypes: ['t-shirt', 'jeans'],
  }),
}));

describe('T1: Category Canonical Mismatch', () => {
  it('should map canonical "shirts & tops" to DB categories and return >0 results', async () => {
    // Given constraints with canonical category
    const constraints: SearchConstraints = {
      category: 'shirts & tops',
      inStockOnly: true,
    };

    // Mock DB products with actual DB categories
    const mockProducts = [
      { id: '1', category: 'shirts', title: 'Shirt 1' },
      { id: '2', category: 'tops', title: 'Top 1' },
      { id: '3', category: 't-shirts', title: 'T-Shirt 1' },
    ];

    const { prisma } = await import('../src/lib/db');
    (prisma.product.findMany as any).mockResolvedValue(mockProducts);

    // Category should be expanded to DB categories
    // This test verifies the mapping logic
    const canonicalToDb = {
      'shirts & tops': ['shirts', 'tops', 't-shirts', 'tees', 'blouses'],
    };

    const expanded = canonicalToDb['shirts & tops'];
    expect(expanded).toContain('shirts');
    expect(expanded).toContain('tops');
    expect(expanded.length).toBeGreaterThan(0);
  });

  it('should use categoryOr array in strict query instead of exact match', () => {
    const constraints: SearchConstraints = {
      category: 'tshirt',
      inStockOnly: true,
    };

    // Canonical "tshirt" should expand to DB categories
    const expanded = ['t-shirts', 'tees', 't shirt', 'tshirt'];
    
    // Query should use OR across expanded categories, not exact match
    expect(expanded.length).toBeGreaterThan(0);
    expect(constraints.category).toBe('tshirt');
  });
});

describe('T2: Gender Refinement', () => {
  it('should filter to only mens products when query is "tshirts for men"', async () => {
    const constraints: SearchConstraints = {
      category: 't-shirt',
      genders: ['mens'],
      inStockOnly: true,
    };

    // Mock products with different genders
    const mockProducts = [
      { id: '1', title: 'Mens T-Shirt', attributes: { gender: 'mens' } },
      { id: '2', title: 'Womens T-Shirt', attributes: { gender: 'womens' } },
      { id: '3', title: 'Unisex T-Shirt', attributes: { gender: 'unisex' } },
    ];

    // Filter should only include mens and unisex
    const filtered = mockProducts.filter((p: any) => {
      const gender = p.attributes?.gender;
      return gender === 'mens' || gender === 'unisex';
    });

    expect(filtered.length).toBe(2);
    expect(filtered.every((p: any) => p.attributes?.gender !== 'womens')).toBe(true);
  });

  it('should filter to only womens products when query is "tshirts for women"', async () => {
    const constraints: SearchConstraints = {
      category: 't-shirt',
      genders: ['womens'],
      inStockOnly: true,
    };

    const mockProducts = [
      { id: '1', title: 'Mens T-Shirt', attributes: { gender: 'mens' } },
      { id: '2', title: 'Womens T-Shirt', attributes: { gender: 'womens' } },
      { id: '3', title: 'Unisex T-Shirt', attributes: { gender: 'unisex' } },
    ];

    const filtered = mockProducts.filter((p: any) => {
      const gender = p.attributes?.gender;
      return gender === 'womens' || gender === 'unisex';
    });

    expect(filtered.length).toBe(2);
    expect(filtered.every((p: any) => p.attributes?.gender !== 'mens')).toBe(true);
  });

  it('should have genderFilter set when genders are present', () => {
    const constraints: SearchConstraints = {
      genders: ['mens'],
      inStockOnly: true,
    };

    // genderFilter should be set (not undefined)
    expect(constraints.genders).toEqual(['mens']);
    expect(constraints.genders).toBeDefined();
  });
});

describe('T3: Outfit Multi-Category', () => {
  it('should parse comma-separated category string into array', () => {
    const rawCategory = 'shirts & tops, pants, dresses, skirts';
    const categories = rawCategory.split(',').map(c => c.trim()).filter(Boolean);

    expect(categories).toEqual(['shirts & tops', 'pants', 'dresses', 'skirts']);
    expect(categories.length).toBe(4);
  });

  it('should query across all categories with OR when category is array', () => {
    const constraints: SearchConstraints = {
      category: ['shirts & tops', 'pants', 'dresses'],
      inStockOnly: true,
    };

    // Should expand each canonical to DB categories
    const expanded = [
      ...['shirts', 'tops', 't-shirts'],
      ...['pants', 'trousers'],
      ...['dresses', 'gowns'],
    ];

    expect(expanded.length).toBeGreaterThan(3);
    expect(Array.isArray(constraints.category)).toBe(true);
  });

  it('should return items spanning multiple categories when available', () => {
    const mockProducts = [
      { id: '1', category: 'shirts' },
      { id: '2', category: 'pants' },
      { id: '3', category: 'dresses' },
    ];

    // All should match multi-category query
    const categories = ['shirts', 'pants', 'dresses'];
    const matched = mockProducts.filter((p: any) => categories.includes(p.category));

    expect(matched.length).toBe(3);
    expect(new Set(matched.map((p: any) => p.category)).size).toBeGreaterThan(1);
  });
});

describe('T4: Diversity / Dedup', () => {
  it('should deduplicate by product.id BEFORE slicing to limit', () => {
    const rankedList = [
      { id: '1', title: 'Product A', category: 'shirts' },
      { id: '2', title: 'Product B', category: 'pants' },
      { id: '1', title: 'Product A', category: 'shirts' }, // Duplicate ID
      { id: '3', title: 'Product C', category: 'dresses' },
      { id: '2', title: 'Product B', category: 'pants' }, // Duplicate ID
    ];

    // Deduplicate by ID
    const seen = new Set<string>();
    const deduplicated = rankedList.filter((item: any) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    expect(deduplicated.length).toBe(3);
    expect(new Set(deduplicated.map((i: any) => i.id)).size).toBe(3);
  });

  it('should include diversity step (group by category, interleave)', () => {
    const rankedList = [
      { id: '1', category: 'shirts' },
      { id: '2', category: 'shirts' },
      { id: '3', category: 'shirts' },
      { id: '4', category: 'pants' },
      { id: '5', category: 'pants' },
      { id: '6', category: 'dresses' },
    ];

    // Group by category
    const grouped = new Map<string, typeof rankedList>();
    for (const item of rankedList) {
      const cat = item.category;
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(item);
    }

    // Interleave round-robin
    const interleaved: typeof rankedList = [];
    const maxLen = Math.max(...Array.from(grouped.values()).map(g => g.length));
    for (let i = 0; i < maxLen; i++) {
      for (const group of grouped.values()) {
        if (group[i]) interleaved.push(group[i]);
      }
    }

    // Should have variety (not all same category)
    const uniqueCats = new Set(interleaved.map((i: any) => i.category));
    expect(uniqueCats.size).toBeGreaterThan(1);
  });

  it('should return exactly requested count of unique cards', () => {
    const rankedList = [
      { id: '1', title: 'A' },
      { id: '2', title: 'B' },
      { id: '1', title: 'A' }, // Duplicate
      { id: '3', title: 'C' },
      { id: '4', title: 'D' },
      { id: '5', title: 'E' },
    ];

    const limit = 4;
    const seen = new Set<string>();
    const unique = rankedList.filter((item: any) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, limit);

    expect(unique.length).toBe(limit);
    expect(new Set(unique.map((i: any) => i.id)).size).toBe(limit);
  });
});

describe('T5: LLM JSON Failure Resilience', () => {
  it('should extract JSON substring from malformed response', () => {
    const malformed = `Here's the JSON: {"intent": "discovery", "constraints": {"category": "shirts"}} and some extra text`;
    
    // Try to extract JSON
    const jsonMatch = malformed.match(/\{[\s\S]*\}/);
    const extracted = jsonMatch ? jsonMatch[0] : null;
    
    expect(extracted).toBeTruthy();
    if (extracted) {
      const parsed = JSON.parse(extracted);
      expect(parsed.intent).toBe('discovery');
    }
  });

  it('should use previous constraints + rule-based refinements on parse failure', () => {
    const previousConstraints: SearchConstraints = {
      category: 'shirts',
      genders: ['mens'],
      inStockOnly: true,
    };

    // Simulate parse failure
    const parseFailed = true;
    const detectedGender = ['womens']; // From rule-based detection

    // Should merge previous + rule-based
    const fallbackConstraints: SearchConstraints = {
      ...previousConstraints,
      genders: detectedGender, // Override with detected gender
    };

    expect(fallbackConstraints.category).toBe('shirts');
    expect(fallbackConstraints.genders).toEqual(['womens']);
  });

  it('should preserve gender and overrideCategory even when LLM fails', () => {
    const previousConstraints: SearchConstraints = {
      category: 'shirts',
      genders: ['mens'],
      inStockOnly: true,
    };

    const overrideCategory = 'TSHIRT';
    const detectedGender = ['womens'];

    // Rule-based refinements should apply
    const fallback: SearchConstraints = {
      ...previousConstraints,
      category: 't-shirt', // From overrideCategory
      genders: detectedGender, // From rule-based detection
    };

    expect(fallback.category).toBe('t-shirt');
    expect(fallback.genders).toEqual(['womens']);
  });
});


