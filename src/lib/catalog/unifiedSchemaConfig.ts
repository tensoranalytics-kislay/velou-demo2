/**
 * Unified Catalog Schema Configuration
 * Defines the standard CSV column schema for vendor catalog uploads
 */

export type FieldGroup =
  | 'identity'
  | 'classification'
  | 'commercial'
  | 'copy'
  | 'experience'
  | 'media'
  | 'extensible'
  | 'telemetry';

export type FieldType = 'string' | 'number' | 'boolean' | 'pipe_list' | 'json' | 'date';

export type RequiredLevel = 'hard' | 'recommended' | 'optional';

export interface CatalogFieldDefinition {
  name: string; // Exact CSV header (case-insensitive, normalized)
  group: FieldGroup;
  type: FieldType;
  requiredLevel: RequiredLevel;
  aliases?: string[]; // Alternative column names (for vendor overrides)
  mapsTo?: {
    model: 'Product';
    field?: string; // Direct DB field: "title", "category", "brand", "id", "productUrl", etc.
    subPath?: string; // JSON path in attributes: "material", "usage_contexts", etc.
  };
  description?: string; // Human-readable description for admin UI
}

export const UNIFIED_CATALOG_SCHEMA: CatalogFieldDefinition[] = [
  // ===== Identity & Linking =====
  {
    name: 'product_id',
    group: 'identity',
    type: 'string',
    requiredLevel: 'hard',
    mapsTo: { model: 'Product', field: 'id' },
    description: 'Unique product identifier (stable primary key)',
  },
  {
    name: 'related_id',
    group: 'identity',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'related_id' },
    description: 'Related product ID (for variants/bundles)',
  },
  {
    name: 'external_sku',
    group: 'identity',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'external_sku' },
    description: 'External SKU/barcode',
  },
  {
    name: 'barcode',
    group: 'identity',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'barcode' },
    description: 'Product barcode',
  },
  {
    name: 'parent_id',
    group: 'identity',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'parent_id' },
    description: 'Parent product ID (for variants)',
  },
  {
    name: 'product_url',
    group: 'identity',
    type: 'string',
    requiredLevel: 'recommended', // Treated as effectively required in validation
    mapsTo: { model: 'Product', field: 'productUrl' },
    description: 'Product detail page URL',
  },
  {
    name: 'image_url_primary',
    group: 'identity',
    type: 'string',
    requiredLevel: 'recommended',
    mapsTo: { model: 'Product', field: 'imageUrl' },
    description: 'Primary product image URL',
  },
  {
    name: 'image_url_alt1',
    group: 'identity',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'image_url_alt1' },
    description: 'Alternate image URL 1',
  },
  {
    name: 'image_url_alt2',
    group: 'identity',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'image_url_alt2' },
    description: 'Alternate image URL 2',
  },
  {
    name: 'image_url_alt3',
    group: 'identity',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'image_url_alt3' },
    description: 'Alternate image URL 3',
  },
  {
    name: 'brand',
    group: 'identity',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', field: 'brand' },
    description: 'Brand name',
  },
  {
    name: 'collection',
    group: 'identity',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'collection' },
    description: 'Product collection name',
  },
  {
    name: 'label',
    group: 'identity',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'label' },
    description: 'Merchant-defined label',
  },

  // ===== Classification =====
  {
    name: 'vertical',
    group: 'classification',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'vertical' },
    description: 'Industry vertical (e.g., "apparel", "furniture", "skincare")',
  },
  {
    name: 'category',
    group: 'classification',
    type: 'string',
    requiredLevel: 'recommended', // Required if subcategory/taxon_path missing
    mapsTo: { model: 'Product', field: 'category' },
    description: 'Primary product category',
  },
  {
    name: 'subcategory',
    group: 'classification',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', field: 'subcategory' },
    description: 'Product subcategory',
  },
  {
    name: 'taxon_path',
    group: 'classification',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'taxon_path' },
    description: 'Taxonomy path (pipe or > delimited)',
  },
  {
    name: 'usage_contexts',
    group: 'classification',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'usage_contexts' },
    description: 'Pipe-delimited usage contexts (e.g., "beach wedding|office desk")',
  },
  {
    name: 'style_tags',
    group: 'classification',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'style_tags' },
    description: 'Aesthetic/style tags (e.g., "mid-century|minimalist")',
  },

  // ===== Commercial =====
  {
    name: 'currency',
    group: 'commercial',
    type: 'string',
    requiredLevel: 'recommended', // Required if price provided
    mapsTo: { model: 'Product', field: 'currency' },
    description: 'Currency code (ISO 4217)',
  },
  {
    name: 'price',
    group: 'commercial',
    type: 'string', // Will be parsed to number
    requiredLevel: 'recommended',
    mapsTo: { model: 'Product', field: 'priceCents' },
    description: 'Product price (will be parsed to cents)',
  },
  {
    name: 'sale_price',
    group: 'commercial',
    type: 'string', // Will be parsed to number
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', field: 'salePriceCents' },
    description: 'Sale price (will be parsed to cents)',
  },
  {
    name: 'price_valid_until',
    group: 'commercial',
    type: 'date',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'price_valid_until' },
    description: 'Price validity date (ISO format)',
  },
  {
    name: 'inventory_status',
    group: 'commercial',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', field: 'stockStatus' },
    description: 'Stock status (in_stock, low_stock, out_of_stock, preorder, discontinued)',
  },
  {
    name: 'inventory_quantity',
    group: 'commercial',
    type: 'number',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'inventory_quantity' },
    description: 'Inventory quantity',
  },
  {
    name: 'lead_time_days',
    group: 'commercial',
    type: 'number',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'lead_time_days' },
    description: 'Lead time in days',
  },
  {
    name: 'ship_regions',
    group: 'commercial',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'ship_regions' },
    description: 'Pipe-delimited shipping regions',
  },

  // ===== Descriptive Copy =====
  {
    name: 'title',
    group: 'copy',
    type: 'string',
    requiredLevel: 'recommended', // OR short_title must exist
    mapsTo: { model: 'Product', field: 'title' },
    description: 'Product title',
  },
  {
    name: 'short_title',
    group: 'copy',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'short_title' },
    description: 'Short product title (fallback if title missing)',
  },
  {
    name: 'description',
    group: 'copy',
    type: 'string',
    requiredLevel: 'recommended',
    mapsTo: { model: 'Product', field: 'description' },
    description: 'Product description',
  },
  {
    name: 'bullet_highlights',
    group: 'copy',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'bullet_highlights' },
    description: 'Pipe-delimited bullet highlights',
  },
  {
    name: 'product_highlights',
    group: 'copy',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'product_highlights' },
    description: 'Structured product highlights',
  },
  {
    name: 'product_details',
    group: 'copy',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'product_details' },
    description: 'Pipe-delimited key:value pairs',
  },
  {
    name: 'care_instructions',
    group: 'copy',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'care_instructions' },
    description: 'Care instructions',
  },
  {
    name: 'materials',
    group: 'copy',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'material' },
    description: 'Material composition',
  },
  {
    name: 'ingredients',
    group: 'copy',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'ingredients' },
    description: 'Product ingredients',
  },
  {
    name: 'dimensions',
    group: 'copy',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'dimensions' },
    description: 'Product dimensions',
  },
  {
    name: 'weight',
    group: 'copy',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'weight' },
    description: 'Product weight',
  },
  {
    name: 'size_fit_notes',
    group: 'copy',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'size_fit_notes' },
    description: 'Size and fit notes',
  },

  // ===== Experience & Efficacy =====
  {
    name: 'benefits',
    group: 'experience',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'benefits' },
    description: 'Pipe-delimited benefit statements',
  },
  {
    name: 'claims',
    group: 'experience',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'claims' },
    description: 'Pipe-delimited claims (e.g., "clinically proven", "B Corp")',
  },
  {
    name: 'safety_compliance',
    group: 'experience',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'safety_compliance' },
    description: 'Pipe-delimited safety compliance (e.g., "UL", "FDA", "CE")',
  },
  {
    name: 'usage_instructions',
    group: 'experience',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'usage_instructions' },
    description: 'How to use the product',
  },
  {
    name: 'sensory_profile',
    group: 'experience',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'sensory_profile' },
    description: 'Sensory profile (e.g., "scent:shea", "finish:matte")',
  },
  {
    name: 'compatibility',
    group: 'experience',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'compatibility' },
    description: 'Pipe-delimited compatibility (e.g., "skin type:dry", "room size:small")',
  },

  // ===== Media & Merchandising =====
  {
    name: 'media_gallery',
    group: 'media',
    type: 'json',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'media_gallery' },
    description: 'JSON array of media URLs with labels',
  },
  {
    name: 'video_url',
    group: 'media',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'video_url' },
    description: 'Product video URL',
  },
  {
    name: 'attribute_chips',
    group: 'media',
    type: 'pipe_list',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'attribute_chips' },
    description: 'Pre-selected chip labels for UI',
  },
  {
    name: 'cta_url_override',
    group: 'media',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'cta_url_override' },
    description: 'Override product_url for CTA',
  },

  // ===== Extensible =====
  {
    name: 'attribute_blob',
    group: 'extensible',
    type: 'json', // Can be pipe_list or JSON string
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'extensible' },
    description: 'Structured attributes in namespace:Key:Value format',
  },

  // ===== Telemetry =====
  {
    name: 'analytics_sku',
    group: 'telemetry',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'analytics_sku' },
    description: 'Analytics SKU',
  },
  {
    name: 'pdp_tracking_id',
    group: 'telemetry',
    type: 'string',
    requiredLevel: 'optional',
    mapsTo: { model: 'Product', subPath: 'pdp_tracking_id' },
    description: 'PDP tracking ID',
  },
];

/**
 * Get field definition by name (case-insensitive)
 */
export function getFieldDefinition(
  name: string,
  schema: CatalogFieldDefinition[] = UNIFIED_CATALOG_SCHEMA
): CatalogFieldDefinition | undefined {
  const normalized = name.toLowerCase().trim();
  return schema.find(
    (field) =>
      field.name.toLowerCase() === normalized ||
      field.aliases?.some((alias) => alias.toLowerCase() === normalized)
  );
}

/**
 * Get all fields by group
 */
export function getFieldsByGroup(
  group: FieldGroup,
  schema: CatalogFieldDefinition[] = UNIFIED_CATALOG_SCHEMA
): CatalogFieldDefinition[] {
  return schema.filter((field) => field.group === group);
}

