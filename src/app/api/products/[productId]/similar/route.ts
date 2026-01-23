import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';
import type { ProductCard } from '@/lib/llm/orchestrator/cards';

const EMBEDDING_DIMENSIONS = 1536; // text-embedding-3-small uses 1536 dimensions

// Import functions from orchestrator
async function loadFashionProducts(
  productIds: string[],
  merchantId?: string
): Promise<Array<{
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  productUrl: string;
  priceCents: number;
  salePriceCents: number | null;
  currency: string;
  category: string;
  stockStatus: string;
  attributes: any;
}>> {
  if (productIds.length === 0) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      ...(merchantId ? { merchantId } : {}),
      isActive: true,
    },
    select: {
      id: true,
      title: true,
      description: true,
      imageUrl: true,
      productUrl: true,
      priceCents: true,
      salePriceCents: true,
      currency: true,
      category: true,
      stockStatus: true,
      attributes: true,
    },
  });

  return products.map(product => ({
    id: product.id,
    title: product.title,
    description: product.description,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    priceCents: product.priceCents,
    salePriceCents: product.salePriceCents,
    currency: product.currency,
    category: product.category,
    stockStatus: product.stockStatus,
    attributes: (product.attributes ?? {}) as any,
  }));
}

// Helper to extract attribute values
function extractAttr(attrs: any, key: string): string | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const value = attrs[key] || attrs[key.toLowerCase()];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0].trim();
  }
  return null;
}

// Extract product type from title (e.g., "dress", "top", "bottom", "skirt", etc.)
function extractProductType(title: string, category: string): string | null {
  if (!title) return null;
  
  const titleLower = title.toLowerCase();
  const categoryLower = category.toLowerCase();
  
  // Product type keywords in order of specificity
  const productTypes: Array<{ keywords: string[]; type: string }> = [
    { keywords: ['maxi dress', 'midi dress', 'mini dress'], type: 'dress' },
    { keywords: ['dress', 'gown'], type: 'dress' },
    { keywords: ['top', 'blouse', 'shirt', 'sweater', 'cardigan', 'hoodie', 'pullover', 'jacket', 'blazer', 'coat'], type: 'top' },
    { keywords: ['bottom', 'pant', 'pants', 'trouser', 'trousers', 'jean', 'jeans', 'legging', 'leggings'], type: 'bottom' },
    { keywords: ['skirt'], type: 'skirt' },
    { keywords: ['short', 'shorts'], type: 'shorts' },
    { keywords: ['swimsuit', 'bikini', 'swimwear'], type: 'swimwear' },
    { keywords: ['bag', 'tote', 'handbag', 'purse', 'backpack', 'crossbody'], type: 'bag' },
    { keywords: ['shoe', 'shoes', 'sandal', 'sandals', 'boot', 'boots', 'sneaker', 'sneakers'], type: 'shoes' },
    { keywords: ['jewelry', 'necklace', 'bracelet', 'earring', 'earrings'], type: 'jewelry' },
    { keywords: ['perfume', 'fragrance'], type: 'perfume' },
  ];
  
  // Check title first (more specific)
  for (const { keywords, type } of productTypes) {
    for (const keyword of keywords) {
      if (titleLower.includes(keyword)) {
        return type;
      }
    }
  }
  
  // Fallback to category-based extraction
  if (categoryLower.includes('dress')) return 'dress';
  if (categoryLower.includes('top')) return 'top';
  if (categoryLower.includes('bottom')) return 'bottom';
  if (categoryLower.includes('skirt')) return 'skirt';
  if (categoryLower.includes('swim')) return 'swimwear';
  if (categoryLower.includes('bag')) return 'bag';
  if (categoryLower.includes('shoe')) return 'shoes';
  if (categoryLower.includes('jewelry')) return 'jewelry';
  if (categoryLower.includes('perfume')) return 'perfume';
  
  return null;
}

// Define similar color groups for color matching
const SIMILAR_COLOR_GROUPS: Record<string, string[]> = {
  // Reds
  'red': ['red', 'burgundy', 'maroon', 'crimson', 'scarlet', 'cherry', 'rose', 'pink'],
  'burgundy': ['red', 'burgundy', 'maroon', 'crimson', 'wine'],
  'maroon': ['red', 'burgundy', 'maroon', 'crimson', 'wine'],
  'pink': ['pink', 'rose', 'blush', 'coral', 'salmon', 'peach'],
  'coral': ['coral', 'salmon', 'peach', 'pink', 'orange'],
  
  // Blues
  'blue': ['blue', 'navy', 'teal', 'turquoise', 'aqua', 'cyan', 'sky'],
  'navy': ['blue', 'navy', 'indigo', 'midnight'],
  'teal': ['blue', 'teal', 'turquoise', 'aqua', 'cyan'],
  
  // Greens
  'green': ['green', 'emerald', 'mint', 'sage', 'olive', 'forest', 'lime'],
  'emerald': ['green', 'emerald', 'forest'],
  'mint': ['green', 'mint', 'sage'],
  
  // Yellows/Oranges
  'yellow': ['yellow', 'gold', 'amber', 'mustard', 'lemon'],
  'gold': ['yellow', 'gold', 'amber', 'bronze'],
  'orange': ['orange', 'coral', 'peach', 'tangerine', 'amber'],
  
  // Purples
  'purple': ['purple', 'violet', 'lavender', 'plum', 'mauve'],
  'lavender': ['purple', 'violet', 'lavender', 'mauve'],
  
  // Neutrals
  'black': ['black', 'charcoal', 'navy'],
  'white': ['white', 'ivory', 'cream', 'beige', 'nude'],
  'ivory': ['white', 'ivory', 'cream', 'beige', 'nude'],
  'beige': ['white', 'ivory', 'cream', 'beige', 'nude', 'tan', 'taupe'],
  'gray': ['gray', 'grey', 'charcoal', 'slate', 'silver'],
  'grey': ['gray', 'grey', 'charcoal', 'slate', 'silver'],
  'brown': ['brown', 'tan', 'taupe', 'camel', 'khaki'],
  'tan': ['brown', 'tan', 'taupe', 'beige', 'khaki'],
};

// Get similar colors for a given color
function getSimilarColors(color: string): string[] {
  if (!color) return [];
  const colorLower = color.toLowerCase().trim();
  return SIMILAR_COLOR_GROUPS[colorLower] || [colorLower];
}

// Build product card from product data
function buildProductCard(
  product: Awaited<ReturnType<typeof loadFashionProducts>>[0],
  originalProductTitle: string
): ProductCard {
  const attrs = product.attributes || {};
  
  // Extract key attributes for display
  const keyAttributes: string[] = [];
  const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style');
  const length = extractAttr(attrs, 'Length') || extractAttr(attrs, 'length');
  const occasion = extractAttr(attrs, 'Occasion') || extractAttr(attrs, 'occasion');
  const pattern = extractAttr(attrs, 'Pattern') || extractAttr(attrs, 'pattern');
  const material = extractAttr(attrs, 'Material') || extractAttr(attrs, 'material');
  const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color');
  
  if (style) keyAttributes.push(style);
  if (length) keyAttributes.push(length);
  if (occasion) keyAttributes.push(occasion);
  if (pattern) keyAttributes.push(pattern);
  if (material) keyAttributes.push(material);
  if (color) keyAttributes.push(color);

  return {
    id: product.id,
    title: product.title,
    priceCents: product.priceCents,
    salePriceCents: product.salePriceCents,
    currency: product.currency,
    keyAttributes: keyAttributes.slice(0, 5), // Top 5 attributes
    reason: `Similar to ${originalProductTitle}`,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    stockStatus: product.stockStatus,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  let productId: string = 'unknown';
  try {
    const resolvedParams = await params;
    productId = resolvedParams.productId;

    // Get excludeProductIds from query parameters (products already shown in search)
    const searchParams = request.nextUrl.searchParams;
    const excludeProductIdsParam = searchParams.get('excludeProductIds');
    const excludeProductIds: string[] = excludeProductIdsParam 
      ? excludeProductIdsParam.split(',').filter(id => id.trim().length > 0)
      : [];

    // Get default merchant
    const defaultMerchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
    if (!defaultMerchant) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 500 }
      );
    }

    // Get the product with all required attributes for matching
    // Prisma doesn't handle pgvector types well, so we use raw SQL
    let productResult: Array<{
      id: string;
      title: string;
      merchantId: string;
      category: string;
      gender: string | null;
      ageGroup: string | null;
      inclusivitySizing: string | null;
      priceCents: number;
      stockStatus: string;
      isActive: boolean;
      color: string | null;
      enrichedColor: string | null;
      setVsSingle: string | null;
      embedding_json: string | null;
    }>;
    try {
      productResult = await prisma.$queryRawUnsafe<Array<{
        id: string;
        title: string;
        merchantId: string;
        category: string;
        gender: string | null;
        ageGroup: string | null;
        inclusivitySizing: string | null;
        priceCents: number;
        stockStatus: string;
        isActive: boolean;
        color: string | null;
        enrichedColor: string | null;
        setVsSingle: string | null;
        embedding_json: string | null;
      }>>(
        `SELECT 
          id, 
          title, 
          "merchantId", 
          category,
          gender,
          "ageGroup",
          "inclusivitySizing",
          "priceCents",
          "stockStatus",
          "isActive",
          color,
          "enrichedColor",
          COALESCE(attributes->>'setVsSingle', attributes->>'SetVsSingle', attributes->>'set_vs_single') as "setVsSingle",
          embedding::text as "embedding_json"
        FROM "Product" 
        WHERE id = $1`,
        productId
      );
    } catch (dbError) {
      logger.error('similar_products_db_query_error', {
        error: dbError instanceof Error ? dbError.message : String(dbError),
        productId,
        operation: 'fetch_product',
      });
      throw new Error(`Database error while fetching product: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
    }

    if (!productResult || productResult.length === 0) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    const product = productResult[0];
    
    // Extract colors: prefer enrichedColor, fallback to color
    // Handle both single color and comma-separated colors
    const productColors: string[] = [];
    if (product.enrichedColor) {
      // enrichedColor can be comma-separated
      productColors.push(...product.enrichedColor.split(',').map(c => c.trim()).filter(c => c.length > 0));
    } else if (product.color) {
      productColors.push(product.color.trim());
    }
    
    // Normalize colors to lowercase for matching
    const normalizedProductColors = productColors.map(c => c.toLowerCase().trim()).filter(c => c.length > 0);

    // Verify merchant matches
    if (product.merchantId !== defaultMerchant.id) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    // Check if product has embedding (optional - we can still find similar products without it)
    let embedding: number[] | null = null;
    if (product.embedding_json) {
      try {
        embedding = JSON.parse(product.embedding_json);
        if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
          logger.warn('similar_products_invalid_embedding_dimensions', {
            productId,
            expected: EMBEDDING_DIMENSIONS,
            actual: Array.isArray(embedding) ? embedding.length : 'not an array',
          });
          embedding = null;
        }
      } catch (error) {
        logger.warn('similar_products_embedding_parse_error', {
          productId,
          error: error instanceof Error ? error.message : String(error),
        });
        embedding = null;
      }
    }

    // Build WHERE conditions for matching products
    // Must match: Category, Gender, AgeGroup, SetVsSingle, Price (similar range), Stock (in_stock), Active (isActive), MerchantId, InclusivitySizing
    const whereConditions: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    // MerchantId (required)
    whereConditions.push(`p."merchantId" = $${paramIndex}`);
    queryParams.push(product.merchantId);
    paramIndex++;

    // Category (required)
    whereConditions.push(`p.category = $${paramIndex}`);
    queryParams.push(product.category);
    paramIndex++;

    // Gender (if product has gender)
    if (product.gender) {
      whereConditions.push(`p.gender = $${paramIndex}`);
      queryParams.push(product.gender);
      paramIndex++;
    } else {
      // If product has no gender, match products with no gender or unisex
      whereConditions.push(`(p.gender IS NULL OR p.gender = 'unisex')`);
    }

    // AgeGroup (if product has ageGroup)
    if (product.ageGroup) {
      whereConditions.push(`p."ageGroup" = $${paramIndex}`);
      queryParams.push(product.ageGroup);
      paramIndex++;
    } else {
      // If product has no ageGroup, match products with no ageGroup
      whereConditions.push(`p."ageGroup" IS NULL`);
    }

    // InclusivitySizing (if product has inclusivitySizing)
    if (product.inclusivitySizing) {
      whereConditions.push(`p."inclusivitySizing" = $${paramIndex}`);
      queryParams.push(product.inclusivitySizing);
      paramIndex++;
    } else {
      // If product has no inclusivitySizing, match products with no inclusivitySizing
      whereConditions.push(`p."inclusivitySizing" IS NULL`);
    }

    // SetVsSingle (from attributes JSON)
    if (product.setVsSingle) {
      whereConditions.push(`COALESCE(p.attributes->>'setVsSingle', p.attributes->>'SetVsSingle', p.attributes->>'set_vs_single') = $${paramIndex}`);
      queryParams.push(product.setVsSingle);
      paramIndex++;
    } else {
      // If product has no setVsSingle, match products with no setVsSingle (defaults to "Single")
      whereConditions.push(`COALESCE(p.attributes->>'setVsSingle', p.attributes->>'SetVsSingle', p.attributes->>'set_vs_single', 'Single') = 'Single'`);
    }

    // Stock (must be in_stock)
    whereConditions.push(`p."stockStatus" = 'in_stock'`);

    // Active (must be active)
    whereConditions.push(`p."isActive" = true`);

    // Price (similar range: within 20% of original price)
    const priceTolerance = Math.round(product.priceCents * 0.2);
    const priceMin = product.priceCents - priceTolerance;
    const priceMax = product.priceCents + priceTolerance;
    whereConditions.push(`p."priceCents" >= $${paramIndex} AND p."priceCents" <= $${paramIndex + 1}`);
    queryParams.push(priceMin, priceMax);
    paramIndex += 2;

    // Exclude the original product
    whereConditions.push(`p.id != $${paramIndex}`);
    queryParams.push(productId);
    paramIndex++;

    // Exclude products already shown (if provided)
    if (excludeProductIds.length > 0) {
      whereConditions.push(`p.id != ALL($${paramIndex}::text[])`);
      queryParams.push(excludeProductIds);
      paramIndex++;
    }

    // Color matching: Match ANY one or more of the product's colors (OR logic)
    // Check both enrichedColor and color columns
    // Track the color array parameter index for use in ranking
    let colorArrayParamIndex: number | null = null;
    if (normalizedProductColors.length > 0) {
      // Build array of color values for SQL ANY() check
      colorArrayParamIndex = paramIndex;
      const colorArrayParam = `$${colorArrayParamIndex}::text[]`;
      queryParams.push(normalizedProductColors);
      paramIndex++;
      
      // Match if enrichedColor or color contains any of the product colors
      // enrichedColor can be comma-separated, so we need to split and check
      whereConditions.push(`(
        -- Check enrichedColor (can be comma-separated)
        EXISTS (
          SELECT 1 FROM unnest(string_to_array(LOWER(COALESCE(p."enrichedColor", '')), ',')) AS enriched_color_val
          WHERE TRIM(enriched_color_val) = ANY(${colorArrayParam})
        )
        OR
        -- Check color column
        LOWER(COALESCE(p.color, '')) = ANY(${colorArrayParam})
        OR
        -- Check attributes JSON as fallback
        LOWER(COALESCE(p.attributes->>'Color', p.attributes->>'color', '')) = ANY(${colorArrayParam})
      )`);
    }

    // Search for similar products with priority: same category > same color > same style > vector similarity
    // Use the same deduplication logic as product discovery:
    // extract shopifyProductId from product id > parent_id > shopifyProductId > related_id > sourceId pattern > product id (fallback)
    // We query for more products (50) to account for deduplication and filtering, then take top 4 unique products
    const dedupKeyExpr = `
      COALESCE(
        -- Extract the first numeric sequence (9+ digits) that appears after "shopify" (case-insensitive)
        -- This captures the Shopify product ID regardless of variant or pattern variations
        -- Pattern examples: loveshackfancy_Shopify_8203037769913_45309911892153
        --                   loveshackfancy_shopify_US_8203037769913_45309911892153
        -- This ensures consistent deduplication regardless of parent_id or shopifyProductId column values
        (
          SELECT (regexp_match(p.id, '.*shopify[^0-9]*([0-9]{9,})', 'i'))[1]
        ),
        NULLIF(p.attributes->>'parent_id', ''),
        NULLIF(p.attributes->>'related_id', ''),
        NULLIF(p."shopifyProductId"::text, ''),
        NULLIF(p.attributes->>'shopifyProductId', ''),
        CASE
          WHEN p."sourceId" IS NOT NULL AND p."sourceId" != ''
          THEN regexp_replace(p."sourceId", '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
          WHEN p.attributes->>'sourceId' IS NOT NULL AND p.attributes->>'sourceId' != ''
          THEN regexp_replace(p.attributes->>'sourceId', '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
          ELSE NULL
        END,
        p.id
      )
    `;

    // Get the dedup_key of the original product to exclude all variants
    let originalDedupKey: string | null = null;
    try {
      const originalDedupKeyExpr = dedupKeyExpr.replace(/p\./g, 'p_orig.');
      const originalDedupResult = await prisma.$queryRawUnsafe<Array<{ dedup_key: string | null }>>(
        `SELECT ${originalDedupKeyExpr} as dedup_key FROM "Product" p_orig WHERE p_orig.id = $1`,
        productId
      );
      if (originalDedupResult && originalDedupResult.length > 0) {
        originalDedupKey = originalDedupResult[0].dedup_key;
      }
    } catch (error) {
      logger.warn('similar_products_original_dedup_key_error', {
        error: error instanceof Error ? error.message : String(error),
        productId,
      });
    }

    // Build the query with optional embedding similarity
    // If embedding exists, use it for ranking; otherwise just return matching products
    const embeddingParamIndex = embedding ? paramIndex : null;
    const embeddingSimilarityExpr = embedding && embeddingParamIndex
      ? `1 - (p.embedding <=> $${embeddingParamIndex}::vector) as similarity,`
      : `0.5 as similarity,`;
    
    if (embedding) {
      queryParams.push(JSON.stringify(embedding));
      paramIndex++;
    }

    // Add color match score for ranking (products matching colors rank higher)
    // Use the same parameter index as in WHERE condition (tracked earlier)
    const colorMatchScoreExpr = normalizedProductColors.length > 0 && colorArrayParamIndex !== null
      ? `CASE 
          WHEN EXISTS (
            SELECT 1 FROM unnest(string_to_array(LOWER(COALESCE(p."enrichedColor", '')), ',')) AS enriched_color_val
            WHERE TRIM(enriched_color_val) = ANY($${colorArrayParamIndex}::text[])
          ) OR LOWER(COALESCE(p.color, '')) = ANY($${colorArrayParamIndex}::text[])
          OR LOWER(COALESCE(p.attributes->>'Color', p.attributes->>'color', '')) = ANY($${colorArrayParamIndex}::text[])
          THEN 1
          ELSE 0
        END as color_match_score,`
      : `0 as color_match_score,`;

    let query = `
      WITH ranked_products AS (
        SELECT 
          p.id as "productId",
          ${embeddingSimilarityExpr}
          ${colorMatchScoreExpr}
          ${dedupKeyExpr} as dedup_key
        FROM "Product" p
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY 
          color_match_score DESC,
          ${embedding ? 'similarity DESC' : 'p."priceCents" ASC'}
        LIMIT 50
      ),
      deduplicated AS (
        SELECT 
          "productId",
          similarity,
          color_match_score,
          dedup_key,
          ROW_NUMBER() OVER (
            PARTITION BY dedup_key
            ORDER BY color_match_score DESC, similarity DESC
          ) as dedup_rank
        FROM ranked_products
      )
      SELECT 
        "productId",
        similarity
      FROM deduplicated
      WHERE dedup_rank = 1
        ${originalDedupKey ? `AND dedup_key != $${paramIndex}` : ''}
      ORDER BY color_match_score DESC, similarity DESC
      LIMIT 4
    `;
    
    if (originalDedupKey) {
      queryParams.push(originalDedupKey);
    }

    let similarResults: Array<{ productId: string; similarity: number }>;
    try {
      similarResults = await prisma.$queryRawUnsafe<Array<{ productId: string; similarity: number }>>(
        query,
        ...queryParams
      );
    } catch (dbError) {
      logger.error('similar_products_search_error', {
        error: dbError instanceof Error ? dbError.message : String(dbError),
        stack: dbError instanceof Error ? dbError.stack : undefined,
        productId,
        operation: 'similar_products_search',
        hasEmbedding: !!embedding,
        category: product.category,
        hasColors: normalizedProductColors.length > 0,
        whereConditionsCount: whereConditions.length,
      });
      // Return empty results rather than throwing
      similarResults = [];
    }

    // Extract product IDs (already deduplicated and filtered to top 4)
    const similarProductIds = similarResults.map(result => result.productId);

    if (similarProductIds.length === 0) {
      return NextResponse.json({ productCards: [] });
    }

    // Load full product data
    const similarProducts = await loadFashionProducts(similarProductIds, defaultMerchant.id);

    // Filter out products that don't match the original category exactly
    // Also filter by language if we can detect it from the original product title
    const originalTitle = product.title;
    
    // Simple language detection: check if title contains non-ASCII characters (likely non-English)
    // For English products, filter out products with non-ASCII characters in title
    // For non-English products, try to match language patterns
    const isEnglishProduct = /^[a-zA-Z0-9\s\-\.,'":;!?()]+$/.test(originalTitle);
    
    const filteredSimilarProducts = similarProducts.filter(p => {
      // CRITICAL: Must match category exactly (case-sensitive, exact match)
      if (p.category !== product.category) {
        logger.debug('similar_products_category_mismatch', {
          originalCategory: product.category,
          productCategory: p.category,
          productId: p.id,
          productTitle: p.title.substring(0, 50),
        });
        return false;
      }
      
      // Language filtering: if original is English, exclude non-English products
      if (isEnglishProduct) {
        const isEnglish = /^[a-zA-Z0-9\s\-\.,'":;!?()]+$/.test(p.title);
        if (!isEnglish) {
          logger.debug('similar_products_language_mismatch_english', {
            originalTitle: originalTitle.substring(0, 50),
            productTitle: p.title.substring(0, 50),
            productId: p.id,
          });
          return false;
        }
      } else {
        // For non-English products, try to match character sets
        // This is a simple heuristic - could be improved
        const originalHasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff]/.test(originalTitle);
        const originalHasCyrillic = /[\u0400-\u04ff]/.test(originalTitle);
        const originalHasArabic = /[\u0600-\u06ff]/.test(originalTitle);
        
        const productHasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff]/.test(p.title);
        const productHasCyrillic = /[\u0400-\u04ff]/.test(p.title);
        const productHasArabic = /[\u0600-\u06ff]/.test(p.title);
        
        // If original has a specific script, the similar product should have the same script
        if (originalHasCJK && !productHasCJK) {
          logger.debug('similar_products_language_mismatch_cjk', {
            originalTitle: originalTitle.substring(0, 50),
            productTitle: p.title.substring(0, 50),
            productId: p.id,
          });
          return false;
        }
        if (originalHasCyrillic && !productHasCyrillic) {
          logger.debug('similar_products_language_mismatch_cyrillic', {
            originalTitle: originalTitle.substring(0, 50),
            productTitle: p.title.substring(0, 50),
            productId: p.id,
          });
          return false;
        }
        if (originalHasArabic && !productHasArabic) {
          logger.debug('similar_products_language_mismatch_arabic', {
            originalTitle: originalTitle.substring(0, 50),
            productTitle: p.title.substring(0, 50),
            productId: p.id,
          });
          return false;
        }
      }
      
      return true;
    });

    // If we filtered out too many, log a warning but still return what we have
    if (filteredSimilarProducts.length < similarProducts.length) {
      logger.warn('similar_products_filtered_by_language_or_category', {
        productId,
        originalCategory: product.category,
        originalTitle: originalTitle.substring(0, 100),
        beforeFilter: similarProducts.length,
        afterFilter: filteredSimilarProducts.length,
        filteredOut: similarProducts.length - filteredSimilarProducts.length,
        filteredCategories: similarProducts
          .filter(p => p.category !== product.category)
          .map(p => p.category),
        filteredTitles: similarProducts
          .filter(p => p.category !== product.category || (isEnglishProduct && !/^[a-zA-Z0-9\s\-\.,'":;!?()]+$/.test(p.title)))
          .map(p => ({ title: p.title.substring(0, 50), category: p.category })),
      });
    }

    // Convert to ProductCard format
    const productCards: ProductCard[] = filteredSimilarProducts.map(p => 
      buildProductCard(p, product.title)
    );

    logger.info('similar_products_found', {
      productId,
      similarCount: productCards.length,
      originalCategory: product.category,
      originalGender: product.gender,
      originalAgeGroup: product.ageGroup,
      originalInclusivitySizing: product.inclusivitySizing,
      originalSetVsSingle: product.setVsSingle,
      originalPriceCents: product.priceCents,
      originalColors: normalizedProductColors,
      originalTitle: originalTitle.substring(0, 100),
      excludeProductIdsCount: excludeProductIds.length,
      matchingCriteria: {
        category: product.category,
        gender: product.gender || 'null/unisex',
        ageGroup: product.ageGroup || 'null',
        inclusivitySizing: product.inclusivitySizing || 'null',
        setVsSingle: product.setVsSingle || 'Single',
        priceRange: `${priceMin}-${priceMax}`,
        colors: normalizedProductColors,
      },
      returnedCategories: filteredSimilarProducts.map(p => p.category),
      rankingPriority: 'color_match_score > embedding_similarity',
    });

    return NextResponse.json({ productCards });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorDetails = {
      message: errorMessage,
      stack: errorStack,
      productId: productId,
      errorType: error?.constructor?.name || typeof error,
    };
    
    logger.error('similar_products_error', errorDetails);
    
    return NextResponse.json(
      { 
        error: 'Failed to find similar products',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}

