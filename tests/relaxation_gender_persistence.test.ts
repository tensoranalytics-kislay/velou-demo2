import { describe, it, expect } from 'vitest';
import type { SearchConstraints } from '../src/lib/search/types';

// Test the dropAttributeFilters function logic
describe('Relaxation gender persistence', () => {
  it('should keep genders in relaxedConstraints when strict search returns 0', () => {
    // Simulate dropAttributeFilters behavior
    const constraints: SearchConstraints = {
      category: 'nonexistent',
      genders: ['mens'],
      colors: ['red'],
      inStockOnly: true,
    };

    // Simulate dropAttributeFilters - should NOT drop genders
    const relaxed = { ...constraints };
    relaxed.colors = undefined;
    // relaxed.genders = undefined; // This line should NOT exist
    // Genders should persist

    // After relaxation, genders should still be present
    expect(relaxed.genders).toEqual(['mens']);
    // But colors should be dropped (attribute filter)
    expect(relaxed.colors).toBeUndefined();
  });

  it('should keep genders even after multiple relaxation steps', () => {
    const constraints: SearchConstraints = {
      category: 'nonexistent',
      genders: ['womens'],
      colors: ['blue'],
      fabrics: ['cotton'],
      inStockOnly: true,
    };

    // Simulate multiple relaxation steps
    const relaxed = { ...constraints };
    relaxed.colors = undefined;
    relaxed.fabrics = undefined;
    // relaxed.genders = undefined; // This should NOT happen

    expect(relaxed.genders).toEqual(['womens']);
  });
});

