/**
 * Category-Specific Attribute Priority Configuration
 * 
 * Defines which attributes are most important for each category.
 * Used to adjust ranking weights dynamically based on category context.
 * 
 * Priority levels:
 * - high: Most important attributes for this category (boost weight by 1.5x)
 * - medium: Important but not critical (use base weight)
 * - low: Less important for this category (reduce weight by 0.7x)
 */

export type AttributePriority = {
  high: string[];
  medium: string[];
  low: string[];
};

export const CATEGORY_ATTRIBUTE_PRIORITY: Record<string, AttributePriority> = {
  "Women's Dresses": {
    high: ["length", "silhouetteCut", "occasionContext", "formalityLevel"],
    medium: ["sleeve", "neckline", "enrichedColor"],
    low: ["fabricFamily", "seasonalCues"],
  },
  "Tops": {
    high: ["sleeve", "length", "fitPreference", "layeringIntent"],
    medium: ["neckline", "enrichedColor", "fabricFamily"],
    low: ["occasionContext", "formalityLevel"],
  },
  "Bottoms": {
    high: ["fitPreference", "riseWaist", "length"],
    medium: ["enrichedColor", "fabricFamily"],
    low: ["occasionContext", "formalityLevel"],
  },
  "Skirts": {
    high: ["length", "silhouetteCut", "occasionContext"],
    medium: ["enrichedColor", "fabricFamily"],
    low: ["formalityLevel"],
  },
  "Accessories": {
    high: ["enrichedColor", "material"],
    medium: ["occasionContext"],
    low: ["formalityLevel", "temperatureIntent"],
  },
  "Girls Dresses": {
    high: ["length", "ageGroup", "occasionContext"],
    medium: ["enrichedColor", "fabricFamily"],
    low: ["formalityLevel"],
  },
  "Girls Tops": {
    high: ["sleeve", "ageGroup", "enrichedColor"],
    medium: ["fabricFamily"],
    low: ["formalityLevel"],
  },
  "Girls Bottoms": {
    high: ["ageGroup", "fitPreference", "enrichedColor"],
    medium: ["fabricFamily"],
    low: ["formalityLevel"],
  },
  "Baby & Toddler Bottoms": {
    high: ["ageGroup", "enrichedColor"],
    medium: ["fabricFamily"],
    low: ["formalityLevel", "occasionContext"],
  },
  "Swimsuits": {
    high: ["temperatureIntent", "humidityFriendly", "enrichedColor"],
    medium: ["formalityLevel", "occasionContext"],
    low: ["fabricFamily"],
  },
  "Bikini Sets": {
    high: ["temperatureIntent", "humidityFriendly", "enrichedColor"],
    medium: ["formalityLevel"],
    low: ["fabricFamily"],
  },
  "Swim Cover-ups": {
    high: ["temperatureIntent", "humidityFriendly", "enrichedColor"],
    medium: ["formalityLevel", "occasionContext"],
    low: ["fabricFamily"],
  },
  "Bedding": {
    high: ["enrichedColor", "material", "fabricFamily"],
    medium: ["seasonalCues"],
    low: ["formalityLevel", "occasionContext"],
  },
  "Towels": {
    high: ["enrichedColor", "material", "fabricFamily"],
    medium: ["seasonalCues"],
    low: ["formalityLevel", "occasionContext"],
  },
  "Perfumes": {
    high: ["enrichedColor", "occasionContext"],
    medium: ["formalityLevel"],
    low: ["temperatureIntent", "humidityFriendly"],
  },
};

/**
 * Get attribute priority for a category
 * 
 * @param category - Product category
 * @returns Attribute priority config or null if category not found
 */
export function getAttributePriority(category: string): AttributePriority | null {
  return CATEGORY_ATTRIBUTE_PRIORITY[category] || null;
}

/**
 * Check if an attribute is high priority for a category
 */
export function isHighPriorityAttribute(category: string, attribute: string): boolean {
  const priority = getAttributePriority(category);
  return priority?.high.includes(attribute) ?? false;
}

/**
 * Check if an attribute is low priority for a category
 */
export function isLowPriorityAttribute(category: string, attribute: string): boolean {
  const priority = getAttributePriority(category);
  return priority?.low.includes(attribute) ?? false;
}


