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

    // Get default merchant
    const defaultMerchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
    if (!defaultMerchant) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 500 }
      );
    }

    // Get the product to find its embedding, category, color, and style using raw SQL
    // Prisma doesn't handle pgvector types well, so we use raw SQL
    // Use array_to_json to convert vector to JSON format for easier parsing
    let productResult: Array<{
      id: string;
      title: string;
      merchantId: string;
      category: string;
      embedding_json: string | null;
      color: string | null;
      style: string | null;
    }>;
    try {
      productResult = await prisma.$queryRawUnsafe<Array<{
        id: string;
        title: string;
        merchantId: string;
        category: string;
        embedding_json: string | null;
        color: string | null;
        style: string | null;
      }>>(
        `SELECT 
          id, 
          title, 
          "merchantId", 
          category,
          embedding::text as "embedding_json",
          COALESCE(attributes->>'Color', attributes->>'color') as color,
          COALESCE(attributes->>'Style', attributes->>'style') as style
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
    const productColor = product.color || null;
    const productStyle = product.style || null;
    const productType = extractProductType(product.title, product.category);
    const similarColors = productColor ? getSimilarColors(productColor) : [];

    // Verify merchant matches
    if (product.merchantId !== defaultMerchant.id) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    // Check if product has embedding
    if (!product.embedding_json) {
      logger.warn('similar_products_no_embedding', { productId });
      return NextResponse.json({ productCards: [] });
    }

    // Parse embedding from JSON array format
    let embedding: number[];
    try {
      embedding = JSON.parse(product.embedding_json);
    } catch (error) {
      logger.warn('similar_products_embedding_parse_error', {
        productId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ productCards: [] });
    }

    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      logger.warn('similar_products_invalid_embedding_dimensions', {
        productId,
        expected: EMBEDDING_DIMENSIONS,
        actual: Array.isArray(embedding) ? embedding.length : 'not an array',
      });
      return NextResponse.json({ productCards: [] });
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

    // Build color and style matching conditions
    // Use parameterized queries to safely handle color/style values
    const colorParam = productColor ? productColor.toLowerCase().trim() : null;
    const styleParam = productStyle ? productStyle.toLowerCase().trim() : null;
    const productTypeParam = productType || null;

    // Get the dedup_key of the original product to exclude all variants
    // Parameters: $1=productId
    let originalDedupKey: string | null = null;
    try {
      // Create a version of dedupKeyExpr that references p_orig instead of p
      const originalDedupKeyExpr = dedupKeyExpr.replace(/p\./g, 'p_orig.');
      const originalDedupResult = await prisma.$queryRawUnsafe<Array<{ dedup_key: string | null }>>(
        `SELECT ${originalDedupKeyExpr} as dedup_key FROM "Product" p_orig WHERE p_orig.id = $1`,
        productId
      );
      if (originalDedupResult && originalDedupResult.length > 0) {
        originalDedupKey = originalDedupResult[0].dedup_key;
      }
      logger.info('similar_products_original_dedup_key', {
        productId,
        originalDedupKey,
      });
    } catch (error) {
      logger.warn('similar_products_original_dedup_key_error', {
        error: error instanceof Error ? error.message : String(error),
        productId,
      });
    }

    // First try: same category, prioritize by: exact color > product type > similar colors > style > vector similarity
    // Parameters: $1=embedding, $2=merchantId, $3=productId, $4=category, $5=color, $6=productType, $7=similarColors (JSON array), $8=style, $9=originalDedupKey
    // Build similar colors array for SQL
    const similarColorsArray = similarColors.length > 0 ? similarColors.map(c => c.toLowerCase().trim()) : [];
    const similarColorsJSON = JSON.stringify(similarColorsArray);
    
    let query = `
      WITH ranked_products AS (
        SELECT 
          p.id as "productId",
          1 - (p.embedding <=> $1::vector) as similarity,
          ${dedupKeyExpr} as dedup_key,
          -- Exact color match (highest priority)
          CASE 
            WHEN $5::text IS NOT NULL AND $5::text != '' 
              AND LOWER(COALESCE(p.attributes->>'Color', p.attributes->>'color', '')) = LOWER($5::text)
            THEN 1 
            ELSE 0 
          END as exact_color_match,
          -- Product type match (extract from title)
          CASE 
            WHEN $6::text IS NOT NULL AND $6::text != ''
              AND (
                LOWER(p.title) LIKE '%' || $6::text || '%'
                OR LOWER(p.category) LIKE '%' || $6::text || '%'
              )
            THEN 1
            ELSE 0
          END as product_type_match,
          -- Similar color match (colors in similar color group)
          CASE 
            WHEN $5::text IS NOT NULL AND $5::text != '' AND $7::jsonb IS NOT NULL AND jsonb_array_length($7::jsonb) > 0
              AND LOWER(COALESCE(p.attributes->>'Color', p.attributes->>'color', '')) = ANY(
                SELECT jsonb_array_elements_text($7::jsonb)
              )
              AND LOWER(COALESCE(p.attributes->>'Color', p.attributes->>'color', '')) != LOWER($5::text)
            THEN 1
            ELSE 0
          END as similar_color_match,
          -- Style match
          CASE 
            WHEN $8::text IS NOT NULL AND $8::text != '' 
              AND LOWER(COALESCE(p.attributes->>'Style', p.attributes->>'style', '')) = LOWER($8::text)
            THEN 1 
            ELSE 0 
          END as style_match
        FROM "Product" p
        WHERE p.embedding IS NOT NULL
          AND p."isActive" = true
          AND p."merchantId" = $2
          AND p."stockStatus" = 'in_stock'
          AND p.id != $3
          AND p.category = $4
        ORDER BY 
          exact_color_match DESC,
          product_type_match DESC,
          similar_color_match DESC,
          style_match DESC,
          p.embedding <=> $1::vector
        LIMIT 50
      ),
      deduplicated AS (
        SELECT 
          "productId",
          similarity,
          exact_color_match,
          product_type_match,
          similar_color_match,
          style_match,
          dedup_key,
          ROW_NUMBER() OVER (
            PARTITION BY dedup_key
            ORDER BY exact_color_match DESC, product_type_match DESC, similar_color_match DESC, style_match DESC, similarity DESC
          ) as dedup_rank
        FROM ranked_products
      )
      SELECT 
        "productId",
        similarity
      FROM deduplicated
      WHERE dedup_rank = 1
        ${originalDedupKey ? `AND dedup_key != $9` : ''}
      ORDER BY exact_color_match DESC, product_type_match DESC, similar_color_match DESC, style_match DESC, similarity DESC
      LIMIT 4
    `;

    let similarResults: Array<{ productId: string; similarity: number }>;
    try {
      const queryParams: any[] = [
        JSON.stringify(embedding),
        defaultMerchant.id,
        productId,
        product.category,
        colorParam || '',
        productTypeParam || '',
        similarColorsJSON, // Similar colors as JSON array
        styleParam || '',
      ];
      if (originalDedupKey) {
        queryParams.push(originalDedupKey);
      }
      similarResults = await prisma.$queryRawUnsafe<Array<{ productId: string; similarity: number }>>(
        query,
        ...queryParams
      );
    } catch (dbError) {
      logger.error('similar_products_vector_search_error', {
        error: dbError instanceof Error ? dbError.message : String(dbError),
        stack: dbError instanceof Error ? dbError.stack : undefined,
        productId,
        operation: 'vector_similarity_search',
        embeddingLength: embedding.length,
        category: product.category,
        hasColor: !!colorParam,
        hasStyle: !!styleParam,
      });
      throw new Error(`Database error during vector search: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
    }

    // If no results with same category, fallback to vector similarity only (any category)
    // BUT: We should still try to match category if possible, so log when fallback is used
    // Parameters: $1=embedding, $2=merchantId, $3=productId, $4=color, $5=style, $6=originalDedupKey
    if (similarResults.length === 0) {
      logger.warn('similar_products_no_results_same_category_using_fallback', {
        productId,
        originalCategory: product.category,
        originalColor: productColor,
        originalStyle: productStyle,
        note: 'Falling back to vector similarity search without category filter',
      });
      query = `
        WITH ranked_products AS (
          SELECT 
            p.id as "productId",
            1 - (p.embedding <=> $1::vector) as similarity,
            ${dedupKeyExpr} as dedup_key,
            CASE 
              WHEN $4::text IS NOT NULL AND $4::text != '' 
                AND LOWER(COALESCE(p.attributes->>'Color', p.attributes->>'color', '')) = LOWER($4::text)
              THEN 1 
              ELSE 0 
            END as color_match,
            CASE 
              WHEN $5::text IS NOT NULL AND $5::text != '' 
                AND LOWER(COALESCE(p.attributes->>'Style', p.attributes->>'style', '')) = LOWER($5::text)
              THEN 1 
              ELSE 0 
            END as style_match
          FROM "Product" p
          WHERE p.embedding IS NOT NULL
            AND p."isActive" = true
            AND p."merchantId" = $2
            AND p."stockStatus" = 'in_stock'
            AND p.id != $3
          ORDER BY 
            color_match DESC,
            style_match DESC,
            p.embedding <=> $1::vector
          LIMIT 50
        ),
        deduplicated AS (
          SELECT 
            "productId",
            similarity,
            color_match,
            style_match,
            dedup_key,
            ROW_NUMBER() OVER (
              PARTITION BY dedup_key
              ORDER BY color_match DESC, style_match DESC, similarity DESC
            ) as dedup_rank
          FROM ranked_products
        )
        SELECT 
          "productId",
          similarity
        FROM deduplicated
        WHERE dedup_rank = 1
          ${originalDedupKey ? `AND dedup_key != $6` : ''}
        ORDER BY color_match DESC, style_match DESC, similarity DESC
        LIMIT 4
      `;

      try {
        const fallbackQueryParams: any[] = [
          JSON.stringify(embedding),
          defaultMerchant.id,
          productId,
          colorParam || '',
          styleParam || '',
        ];
        if (originalDedupKey) {
          fallbackQueryParams.push(originalDedupKey);
        }
        similarResults = await prisma.$queryRawUnsafe<Array<{ productId: string; similarity: number }>>(
          query,
          ...fallbackQueryParams
        );
      } catch (dbError) {
        logger.error('similar_products_fallback_search_error', {
          error: dbError instanceof Error ? dbError.message : String(dbError),
          stack: dbError instanceof Error ? dbError.stack : undefined,
          productId,
          operation: 'fallback_vector_similarity_search',
        });
        // Return empty results rather than throwing
        similarResults = [];
      }
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
      originalColor: productColor,
      originalStyle: productStyle,
      originalProductType: productType,
      similarColors: similarColorsArray,
      originalTitle: originalTitle.substring(0, 100),
      usedCategoryFilter: true,
      languageFiltered: isEnglishProduct,
      returnedCategories: filteredSimilarProducts.map(p => p.category),
      rankingPriority: 'exact_color > product_type > similar_color > style > vector_similarity',
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

