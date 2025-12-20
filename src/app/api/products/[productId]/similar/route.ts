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

    // Get the product to find its embedding and title using raw SQL
    // Prisma doesn't handle pgvector types well, so we use raw SQL
    // Use array_to_json to convert vector to JSON format for easier parsing
    let productResult: Array<{
      id: string;
      title: string;
      merchantId: string;
      embedding_json: string | null;
    }>;
    try {
      productResult = await prisma.$queryRawUnsafe<Array<{
        id: string;
        title: string;
        merchantId: string;
        embedding_json: string | null;
      }>>(
        `SELECT id, title, "merchantId", embedding::text as "embedding_json" FROM "Product" WHERE id = $1`,
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

    // Search for similar products using vector similarity with deduplication
    // Use the same deduplication logic as product discovery:
    // parent_id > shopifyProductId > related_id > sourceId pattern > product id (fallback)
    // We query for more products (20) to account for deduplication, then take top 4 unique products
    const dedupKeyExpr = `
      COALESCE(
        NULLIF(p.attributes->>'parent_id', ''),
        NULLIF(p."shopifyProductId"::text, ''),
        NULLIF(p.attributes->>'shopifyProductId', ''),
        NULLIF(p.attributes->>'related_id', ''),
        CASE
          WHEN p."sourceId" IS NOT NULL AND p."sourceId" != ''
          THEN regexp_replace(p."sourceId", '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
          WHEN p.attributes->>'sourceId' IS NOT NULL AND p.attributes->>'sourceId' != ''
          THEN regexp_replace(p.attributes->>'sourceId', '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
          ELSE p.id
        END
      )
    `;

    const query = `
      WITH ranked_products AS (
        SELECT 
          p.id as "productId",
          1 - (p.embedding <=> $1::vector) as similarity,
          ${dedupKeyExpr} as dedup_key
        FROM "Product" p
        WHERE p.embedding IS NOT NULL
          AND p."isActive" = true
          AND p."merchantId" = $2
          AND p."stockStatus" = 'in_stock'
          AND p.id != $3
        ORDER BY p.embedding <=> $1::vector
        LIMIT 20
      ),
      deduplicated AS (
        SELECT 
          "productId",
          similarity,
          ROW_NUMBER() OVER (
            PARTITION BY dedup_key
            ORDER BY similarity DESC
          ) as dedup_rank
        FROM ranked_products
      )
      SELECT 
        "productId",
        similarity
      FROM deduplicated
      WHERE dedup_rank = 1
      ORDER BY similarity DESC
      LIMIT 4
    `;

    let similarResults: Array<{ productId: string; similarity: number }>;
    try {
      similarResults = await prisma.$queryRawUnsafe<Array<{ productId: string; similarity: number }>>(
        query,
        JSON.stringify(embedding),
        defaultMerchant.id,
        productId
      );
    } catch (dbError) {
      logger.error('similar_products_vector_search_error', {
        error: dbError instanceof Error ? dbError.message : String(dbError),
        stack: dbError instanceof Error ? dbError.stack : undefined,
        productId,
        operation: 'vector_similarity_search',
        embeddingLength: embedding.length,
      });
      throw new Error(`Database error during vector search: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
    }

    // Extract product IDs (already deduplicated and filtered to top 4)
    const similarProductIds = similarResults.map(result => result.productId);

    if (similarProductIds.length === 0) {
      return NextResponse.json({ productCards: [] });
    }

    // Load full product data
    const similarProducts = await loadFashionProducts(similarProductIds, defaultMerchant.id);

    // Convert to ProductCard format
    const productCards: ProductCard[] = similarProducts.map(p => 
      buildProductCard(p, product.title)
    );

    logger.info('similar_products_found', {
      productId,
      similarCount: productCards.length,
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

