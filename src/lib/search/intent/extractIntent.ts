import type { SearchConstraints } from '../types';

export function extractIntentConstraints(
  query: string,
  existingConstraints: SearchConstraints = {},
): Partial<SearchConstraints> {
  if (!query) return {};
  const lower = query.toLowerCase();
  const next: Partial<SearchConstraints> = {};

  // Weather / temperature
  if (/\b(hot|warm|humid|summer)\b/.test(lower)) {
    next.temperatureIntent = 'Warm Weather';
    next.humidityFriendly = true;
  }
  if (/\b(cold|cool|chilly|winter)\b/.test(lower)) {
    next.temperatureIntent = 'Cool Weather';
  }

  // Occasion / formality
  if (/\b(wedding|formal|black tie)\b/.test(lower)) {
    next.formalityLevel = ['Semi-Formal', 'Formal'];
    next.occasionContext = ['Wedding'];
  }
  if (/\b(vacation|travel|beach)\b/.test(lower)) {
    next.occasionContext = [...(next.occasionContext || []), 'Vacation', 'Beach'];
    next.functionFeatures = [...(next.functionFeatures || []), 'Lightweight'];
  }

  // Problem / solution
  if (/\b(wrinkle|wrinkles|wrinkle-free|no wrinkle)\b/.test(lower)) {
    next.problemSolutions = [...(next.problemSolutions || []), 'No Wrinkling'];
  }
  if (/\b(pocket|pockets)\b/.test(lower)) {
    next.functionFeatures = [...(next.functionFeatures || []), 'Pockets'];
  }
  if (/\b(bra-friendly|bra friendly)\b/.test(lower)) {
    next.functionFeatures = [...(next.functionFeatures || []), 'Bra-Friendly'];
  }

  // Color nuance
  if (/\b(light|pale|pastel)\b/.test(lower)) {
    next.colorShade = ['Light'];
  }
  if (/\b(dark|deep|rich)\b/.test(lower)) {
    next.colorShade = ['Dark'];
  }
  if (/\b(warm tone|warm color)\b/.test(lower)) {
    next.colorUndertone = ['Warm'];
  }
  if (/\b(cool tone|cool color)\b/.test(lower)) {
    next.colorUndertone = ['Cool'];
  }

  // Merge with existing (existing wins)
  return { ...existingConstraints, ...next };
}

