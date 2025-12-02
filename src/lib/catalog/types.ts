/**
 * Types for Unified Catalog Ingestion v1
 */

export interface UnifiedVendorCatalogRow {
  // Identity & Linking
  product_id: string | null;
  related_id: string | null;
  external_sku: string | null;
  barcode: string | null;
  parent_id: string | null;
  product_url: string | null;
  image_url_primary: string | null;
  image_url_alt1: string | null;
  image_url_alt2: string | null;
  image_url_alt3: string | null;
  brand: string | null;
  collection: string | null;
  label: string | null;

  // Classification
  vertical: string | null;
  category: string | null;
  subcategory: string | null;
  taxon_path: string | null;
  usage_contexts: string[] | null; // Parsed from pipe_list
  style_tags: string[] | null; // Parsed from pipe_list

  // Commercial
  currency: string | null;
  price: string | null; // Will be parsed to number
  sale_price: string | null; // Will be parsed to number
  price_valid_until: string | null;
  inventory_status: string | null;
  inventory_quantity: string | null; // Will be parsed to number
  lead_time_days: string | null; // Will be parsed to number
  ship_regions: string[] | null; // Parsed from pipe_list

  // Descriptive Copy
  title: string | null;
  short_title: string | null;
  description: string | null;
  bullet_highlights: string[] | null; // Parsed from pipe_list
  product_highlights: string | null;
  product_details: string[] | null; // Parsed from pipe_list (key:value pairs)
  care_instructions: string | null;
  materials: string | null;
  ingredients: string | null;
  dimensions: string | null;
  weight: string | null;
  size_fit_notes: string | null;

  // Experience & Efficacy
  benefits: string[] | null; // Parsed from pipe_list
  claims: string[] | null; // Parsed from pipe_list
  safety_compliance: string[] | null; // Parsed from pipe_list
  usage_instructions: string | null;
  sensory_profile: string | null;
  compatibility: string[] | null; // Parsed from pipe_list

  // Media & Merchandising
  media_gallery: string | null; // JSON string, will be parsed later
  video_url: string | null;
  attribute_chips: string[] | null; // Parsed from pipe_list
  cta_url_override: string | null;

  // Extensible
  attribute_blob: string | null; // Raw string, will be parsed later

  // Telemetry
  analytics_sku: string | null;
  pdp_tracking_id: string | null;
}

export interface CatalogValidationIssue {
  level: 'error' | 'warning';
  field?: string;
  message: string;
  rowIndex?: number;
}

export interface CatalogRowValidationResult {
  isValid: boolean;
  errors: CatalogValidationIssue[];
  warnings: CatalogValidationIssue[];
}

export interface DatasetCoreStats {
  totalRows: number;
  rowsWithCoreIdentity: number; // Has product_id + (title OR short_title) + product_url
  rowsWithCoreClassification: number; // Has at least one of: category, subcategory, taxon_path, vertical
  rowsWithPrice: number; // Has price
  rowsWithCurrency: number; // Has currency
  rowsWithImage: number; // Has image_url_primary
  rowsWithDescription: number; // Has description
  rowsWithCategory: number; // Has category
  rowsWithSubcategory: number; // Has subcategory
  rowsWithBrand: number; // Has brand
}



