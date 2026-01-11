import { describe, it, expect } from 'vitest';
import {
  matchFormalityLevel,
  matchTemperatureIntent,
  matchHumidityFriendly,
  matchOccasionContext,
  matchProblemSolutions,
  matchFunctionFeatures,
  matchColorShade,
  matchColorUndertone,
  matchMulticolor,
  matchSeasonalPalette,
} from '../../loveshackfancy/ranking/constraint-matcher';

describe('enriched attribute matching', () => {
  describe('matchFormalityLevel', () => {
    it('should match exact formality levels', () => {
      expect(matchFormalityLevel('Casual', ['Casual'])).toBe(1.0);
      expect(matchFormalityLevel('Formal', ['Formal'])).toBe(1.0);
      expect(matchFormalityLevel('Semi-Formal', ['Semi-Formal'])).toBe(1.0);
    });

    it('should match case-insensitive', () => {
      expect(matchFormalityLevel('casual', ['Casual'])).toBe(1.0);
      expect(matchFormalityLevel('FORMAL', ['Formal'])).toBe(1.0);
    });

    it('should return 0 for no match', () => {
      expect(matchFormalityLevel('Casual', ['Formal'])).toBe(0);
      expect(matchFormalityLevel(undefined, ['Formal'])).toBe(0);
    });
  });

  describe('matchTemperatureIntent', () => {
    it('should match exact temperature intents', () => {
      expect(matchTemperatureIntent('Warm Weather', 'Warm Weather')).toBe(1.0);
      expect(matchTemperatureIntent('Cool Weather', 'Cool Weather')).toBe(1.0);
    });

    it('should return 0 for no match', () => {
      expect(matchTemperatureIntent('Warm Weather', 'Cool Weather')).toBe(0);
      expect(matchTemperatureIntent(undefined, 'Warm Weather')).toBe(0);
    });
  });

  describe('matchHumidityFriendly', () => {
    it('should match boolean values', () => {
      expect(matchHumidityFriendly(true, true)).toBe(1.0);
      expect(matchHumidityFriendly(false, false)).toBe(1.0);
      expect(matchHumidityFriendly(true, false)).toBe(0);
      expect(matchHumidityFriendly(false, true)).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(matchHumidityFriendly(null, true)).toBe(0);
      expect(matchHumidityFriendly(undefined, true)).toBe(0);
    });
  });

  describe('matchOccasionContext', () => {
    it('should match array intersections', () => {
      expect(matchOccasionContext(['Wedding', 'Vacation'], ['Wedding'])).toBe(1.0);
      expect(matchOccasionContext(['Wedding', 'Vacation'], ['Wedding', 'Beach'])).toBe(0.5); // 1 out of 2
      expect(matchOccasionContext(['Wedding'], ['Wedding', 'Beach'])).toBe(0.5); // 1 out of 2
    });

    it('should return 0 for no match', () => {
      expect(matchOccasionContext(['Wedding'], ['Beach'])).toBe(0);
      expect(matchOccasionContext(null, ['Wedding'])).toBe(0);
      expect(matchOccasionContext([], ['Wedding'])).toBe(0);
    });
  });

  describe('matchProblemSolutions', () => {
    it('should match array intersections', () => {
      expect(matchProblemSolutions(['Wrinkle-Free', 'Pockets'], ['Wrinkle-Free'])).toBe(1.0);
      expect(matchProblemSolutions(['Wrinkle-Free', 'Pockets'], ['Wrinkle-Free', 'Bra-Friendly'])).toBe(0.5); // 1 out of 2
    });

    it('should return 0 for no match', () => {
      expect(matchProblemSolutions(['Wrinkle-Free'], ['Pockets'])).toBe(0);
      expect(matchProblemSolutions(null, ['Wrinkle-Free'])).toBe(0);
    });
  });

  describe('matchFunctionFeatures', () => {
    it('should match array intersections', () => {
      expect(matchFunctionFeatures(['Pockets', 'Adjustable'], ['Pockets'])).toBe(1.0);
      expect(matchFunctionFeatures(['Pockets'], ['Pockets', 'Removable'])).toBe(0.5); // 1 out of 2
    });

    it('should return 0 for no match', () => {
      expect(matchFunctionFeatures(['Pockets'], ['Adjustable'])).toBe(0);
      expect(matchFunctionFeatures(null, ['Pockets'])).toBe(0);
    });
  });

  describe('matchColorShade', () => {
    it('should match exact color shades', () => {
      expect(matchColorShade('Light', ['Light'])).toBe(1.0);
      expect(matchColorShade('Dark', ['Dark'])).toBe(1.0);
      expect(matchColorShade('Medium', ['Medium'])).toBe(1.0);
    });

    it('should return 0 for no match', () => {
      expect(matchColorShade('Light', ['Dark'])).toBe(0);
      expect(matchColorShade(undefined, ['Light'])).toBe(0);
    });
  });

  describe('matchColorUndertone', () => {
    it('should match exact color undertones', () => {
      expect(matchColorUndertone('Warm', ['Warm'])).toBe(1.0);
      expect(matchColorUndertone('Cool', ['Cool'])).toBe(1.0);
      expect(matchColorUndertone('Neutral', ['Neutral'])).toBe(1.0);
    });

    it('should return 0 for no match', () => {
      expect(matchColorUndertone('Warm', ['Cool'])).toBe(0);
      expect(matchColorUndertone(undefined, ['Warm'])).toBe(0);
    });
  });

  describe('matchMulticolor', () => {
    it('should match boolean values', () => {
      expect(matchMulticolor(true, true)).toBe(1.0);
      expect(matchMulticolor(false, false)).toBe(1.0);
      expect(matchMulticolor(true, false)).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(matchMulticolor(null, true)).toBe(0);
      expect(matchMulticolor(undefined, true)).toBe(0);
    });
  });

  describe('matchSeasonalPalette', () => {
    it('should match exact seasonal palettes', () => {
      expect(matchSeasonalPalette('Spring', ['Spring'])).toBe(1.0);
      expect(matchSeasonalPalette('Summer', ['Summer'])).toBe(1.0);
      expect(matchSeasonalPalette('Fall', ['Fall'])).toBe(1.0);
      expect(matchSeasonalPalette('Winter', ['Winter'])).toBe(1.0);
    });

    it('should return 0 for no match', () => {
      expect(matchSeasonalPalette('Spring', ['Summer'])).toBe(0);
      expect(matchSeasonalPalette(undefined, ['Spring'])).toBe(0);
    });
  });
});

