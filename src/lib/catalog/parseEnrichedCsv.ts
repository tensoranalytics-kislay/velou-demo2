import { parse } from 'csv-parse';
import type { EnrichedCatalogRow } from './enrichedTypes';

const toArray = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};

const toBoolean = (value?: string | null): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  const normalized = value.toLowerCase().trim();
  if (['true', 'yes', 'y', '1', 'lined', 'has pockets', 'humidity friendly', 'multicolor'].includes(normalized)) {
    return true;
  }
  if (['false', 'no', 'n', '0', 'unlined', 'no pockets'].includes(normalized)) {
    return false;
  }
  return undefined;
};

export async function* parseEnrichedCsv(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<{
  rowIndex: number;
  raw: Record<string, string>;
  normalized: EnrichedCatalogRow;
}> {
  const parser = stream.pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }),
  );

  let rowIndex = 0;
  for await (const raw of parser) {
    rowIndex += 1;

    const normalized: EnrichedCatalogRow = {
      id: raw['id'],
      item_group_id: raw['item group id'] || raw['item_group_id'],
      sku: raw['sku'] || null,
      mpn: raw['mpn'] || null,
      gtin: raw['gtin'] || null,
      merchant_item_id: raw['merchant item id'] || null,
      brand: raw['brand'],
      title_clean: raw['title_clean'],
      description_clean: raw['description_clean'],
      link_base: raw['link_base'],
      image_link: raw['image_link'],
      additional_image_links: raw['additional_image_links'],
      price: raw['price'],
      sale_price: raw['sale price'] || null,
      availability: raw['availability'],
      variant_sizes: raw['variant_sizes'] || null,
      variant_colors: raw['variant_colors'] || null,
      color: raw['color'] || null,
      material: raw['material'] || null,
      google_product_category: raw['google product category'] || null,
      product_type: raw['product type'] || null,
      domain: raw['domain'] || null,
      taxonomy_path: raw['taxonomy_path'] || null,
      silhouette_cut: raw['silhouette_cut'] || null,
      length: raw['length'] || null,
      sleeve: raw['sleeve'] || null,
      neckline: raw['neckline'] || null,
      closure_construction: raw['closure_construction'] || null,
      lined: raw['lined'] || null,
      set_vs_single: raw['set_vs_single'] || null,
      pack_size: raw['pack_size'] || null,
      fit_preference: raw['fit_preference'] || null,
      rise_waist: raw['rise_waist'] || null,
      stretch_level: raw['stretch_level'] || null,
      body_intent: raw['body_intent'] || null,
      comfort_intent: raw['comfort_intent'] || null,
      sizing_notes: raw['sizing_notes'] || null,
      fabric_family: raw['fabric_family'] || null,
      handfeel: raw['handfeel'] || null,
      warmth_weight: raw['warmth_weight'] || null,
      breathability: raw['breathability'] || null,
      opacity: raw['opacity'] || null,
      wrinkle_behavior: raw['wrinkle_behavior'] || null,
      care_requirements: raw['care_requirements'] || null,
      style_labels: raw['style_labels'] || null,
      vibe_mood: raw['vibe_mood'] || null,
      pattern_print: raw['pattern_print'] || null,
      detailing: raw['detailing'] || null,
      finish: raw['finish'] || null,
      formality_level: raw['formality_level'] || null,
      occasion_context: raw['occasion_context'] || null,
      dress_code: raw['dress_code'] || null,
      modesty_cues: raw['modesty_cues'] || null,
      seasonal_cues: raw['seasonal_cues'] || null,
      temperature_intent: raw['temperature_intent'] || null,
      rain_wind: raw['rain_wind'] || null,
      humidity_friendly: raw['humidity_friendly'] || null,
      movement_needs: raw['movement_needs'] || null,
      travel_features: raw['travel_features'] || null,
      problem_solutions: raw['problem_solutions'] || null,
      function_features: raw['function_features'] || null,
      layering_intent: raw['layering_intent'] || null,
      pairing_intent: raw['pairing_intent'] || null,
      pockets: raw['pockets'] || null,
      lining_type: raw['lining_type'] || null,
      bra_solution: raw['bra_solution'] || null,
      slit: raw['slit'] || null,
      neckline_depth: raw['neckline_depth'] || null,
      waist_structure: raw['waist_structure'] || null,
      hem_style: raw['hem_style'] || null,
      collar_type: raw['collar_type'] || null,
      color_shade: raw['color_shade'] || null,
      color_undertone: raw['color_undertone'] || null,
      multicolor: raw['multicolor'] || null,
      seasonal_palette: raw['seasonal_palette'] || null,
      price_band: raw['price_band'] || null,
      deal_intent: raw['deal_intent'] || null,
      value_framing: raw['value_framing'] || null,
      eco_materials: raw['eco_materials'] || null,
      certifications: raw['certifications'] || null,
      origin: raw['origin'] || null,
      durability_notes: raw['durability_notes'] || null,
      inclusivity_sizing: raw['inclusivity_sizing'] || null,
      adaptive_features: raw['adaptive_features'] || null,
      sensory_friendly: raw['sensory_friendly'] || null,
      social_proof: raw['social_proof'] || null,
      llm_confidence_overall: raw['llm_confidence_overall'] || null,
      llm_evidence_json: raw['llm_evidence_json'] || null,
      enriched_color: raw['enriched_color'] || null,
      age_group: raw['age_group'] || null,
    };

    // Normalize array-ish strings to comma-delimited originals remain as-is; downstream mapping will parse
    normalized.variant_sizes = toArray(normalized.variant_sizes || '').join(', ');
    normalized.variant_colors = toArray(normalized.variant_colors || '').join(', ');

    // Normalize simple booleans as strings; downstream will cast
    const humidityBool = toBoolean(normalized.humidity_friendly);
    normalized.humidity_friendly = humidityBool === undefined ? normalized.humidity_friendly : humidityBool ? 'true' : 'false';

    const linedBool = toBoolean(normalized.lined);
    normalized.lined = linedBool === undefined ? normalized.lined : linedBool ? 'Lined' : 'Unlined';

    const multicolorBool = toBoolean(normalized.multicolor);
    normalized.multicolor = multicolorBool === undefined ? normalized.multicolor : multicolorBool ? 'true' : 'false';

    yield { rowIndex, raw, normalized };
  }
}
