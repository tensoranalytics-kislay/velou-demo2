import { describe, it, expect } from 'vitest';
import type { SearchConstraints } from '../../src/lib/search/types';
import { deriveAttributeConstraintMeta } from '../../src/lib/search/index';

describe('deriveAttributeConstraintMeta', () => {
  it('treats category + price only as having no hard facets', () => {
    const constraints: SearchConstraints = {
      category: 'personal care',
      priceMaxCents: 5000,
      inStockOnly: true,
    };

    const meta = deriveAttributeConstraintMeta(constraints, [{ category: 'personal care' }]);

    expect(meta.hasHardAttributeConstraints).toBe(false);
    expect(meta.hardFacetFields).toEqual([]);
  });

  it('detects explicit facet filters', () => {
    const constraints: SearchConstraints = {
      category: 'personal care',
      colors: ['lavender'],
      useCases: ['bedtime routine'],
    };

    const meta = deriveAttributeConstraintMeta(constraints);

    expect(meta.hasHardAttributeConstraints).toBe(true);
    expect(meta.hardFacetFields).toEqual(expect.arrayContaining(['colors', 'useCases']));
  });

  it('treats productTypes as derived facet hints', () => {
    const constraints: SearchConstraints = {
      category: 'personal care',
      productTypes: ['body scrub'],
    };

    const meta = deriveAttributeConstraintMeta(constraints);

    expect(meta.hasHardAttributeConstraints).toBe(false);
    expect(meta.ignoredDerivedFacetFields).toEqual(expect.arrayContaining(['productTypes']));
  });

  it('ignores descriptive styleTags as hard facets', () => {
    const constraints: SearchConstraints = {
      category: 'personal care',
      styleTags: ['relaxing'],
    };

    const meta = deriveAttributeConstraintMeta(constraints);

    expect(meta.hasHardAttributeConstraints).toBe(false);
    expect(meta.ignoredDerivedFacetFields).toEqual(expect.arrayContaining(['styleTags']));
  });
});


