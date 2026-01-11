/**
 * Type definitions for enriched catalog CSV structure
 * 
 * These types match the structure of the enriched.csv file with 100+ attributes.
 */

/**
 * Enriched catalog row parsed from the new CSV.
 * All fields are optional for robustness; normalization happens downstream.
 */
export interface EnrichedCatalogRow {
  // Identity
  id: string;
  item_group_id: string;
  sku?: string | null;
  mpn?: string | null;
  gtin?: string | null;
  merchant_item_id?: string | null;
  brand: string;
  title_clean: string;
  description_clean?: string | null;
  link_base: string;
  image_link: string;
  additional_image_links?: string | null;

  // Commercial
  price: string;
  sale_price?: string | null;
  availability?: string | null;

  // Variants
  color?: string | null;
  material?: string | null;
  variant_sizes?: string | null;
  variant_colors?: string | null;

  // Taxonomy
  google_product_category?: string | null;
  product_type?: string | null;
  domain?: string | null;
  taxonomy_path?: string | null;

  // Enriched attributes (Fit & Construction)
  silhouette_cut?: string | null;
  length?: string | null;
  sleeve?: string | null;
  neckline?: string | null;
  closure_construction?: string | null;
  lined?: string | null;
  set_vs_single?: string | null;
  pack_size?: string | null;
  fit_preference?: string | null;
  rise_waist?: string | null;
  stretch_level?: string | null;
  body_intent?: string | null;
  comfort_intent?: string | null;
  sizing_notes?: string | null;

  // Enriched attributes (Fabric Properties)
  fabric_family?: string | null;
  handfeel?: string | null;
  warmth_weight?: string | null;
  breathability?: string | null;
  opacity?: string | null;
  wrinkle_behavior?: string | null;
  care_requirements?: string | null;

  // Enriched attributes (Style & Occasion)
  style_labels?: string | null;
  vibe_mood?: string | null;
  pattern_print?: string | null;
  detailing?: string | null;
  finish?: string | null;
  formality_level?: string | null;
  occasion_context?: string | null;
  dress_code?: string | null;
  modesty_cues?: string | null;
  seasonal_cues?: string | null;

  // Enriched attributes (Weather & Comfort)
  temperature_intent?: string | null;
  rain_wind?: string | null;
  humidity_friendly?: string | null;
  movement_needs?: string | null;
  travel_features?: string | null;

  // Enriched attributes (Problem-Solution)
  problem_solutions?: string | null;
  function_features?: string | null;
  layering_intent?: string | null;
  pairing_intent?: string | null;
  pockets?: string | null;
  lining_type?: string | null;
  bra_solution?: string | null;
  slit?: string | null;
  neckline_depth?: string | null;
  waist_structure?: string | null;
  hem_style?: string | null;
  collar_type?: string | null;

  // Enriched attributes (Color Details)
  color_shade?: string | null;
  color_undertone?: string | null;
  multicolor?: string | null;
  seasonal_palette?: string | null;

  // Enriched attributes (Commercial & Value)
  price_band?: string | null;
  deal_intent?: string | null;
  value_framing?: string | null;

  // Enriched attributes (Sustainability & Quality)
  eco_materials?: string | null;
  certifications?: string | null;
  origin?: string | null;
  durability_notes?: string | null;

  // Enriched attributes (Inclusivity)
  inclusivity_sizing?: string | null;
  adaptive_features?: string | null;
  sensory_friendly?: string | null;
  social_proof?: string | null;

  // LLM metadata
  llm_confidence_overall?: string | null;
  llm_evidence_json?: string | null;

  // Enriched 2.csv specific columns
  enriched_color?: string | null;
  age_group?: string | null;
}

// NOTE: Variant-level data (sizes and colors) is stored in Product.attributes
// as arrays (variant_sizes, variant_colors, sizes) for efficient filtering.
// All enriched attributes are stored in indexed Product columns for fast querying.
