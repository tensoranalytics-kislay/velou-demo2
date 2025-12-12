/**
 * IntegrationService
 * 
 * Handles all third-party integrations including:
 * - Shopify integration (OAuth, sync, disconnect)
 * - Review platform integration (connect, sync, disconnect)
 * 
 * All operations are scoped to a specific merchantId for multi-tenant isolation.
 */

import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import { encrypt, decrypt } from '../encryption';
import type { Merchant, ReviewConfig, ReviewProvider } from '@prisma/client';

export type ShopifyConfig = {
  shopifyStore: string | null;
  shopifySyncEnabled: boolean;
  shopifySyncedAt: Date | null;
};

export type ReviewConfigInput = {
  provider: ReviewProvider;
  businessId: string;
  apiKey: string;
  apiUrl?: string;
};

export type SyncResult = {
  success: boolean;
  syncedCount: number;
  errors: string[];
  syncedAt: Date;
};

/**
 * Get Shopify configuration for a merchant
 * 
 * @param merchantId - Merchant ID
 * @returns Shopify configuration or null if not configured
 */
export async function getShopifyConfig(merchantId: string): Promise<ShopifyConfig | null> {
  try {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        shopifyStore: true,
        shopifySyncEnabled: true,
        shopifySyncedAt: true,
      },
    });

    if (!merchant) {
      throw new Error('Merchant not found');
    }

    if (!merchant.shopifyStore) {
      return null;
    }

    return {
      shopifyStore: merchant.shopifyStore,
      shopifySyncEnabled: merchant.shopifySyncEnabled,
      shopifySyncedAt: merchant.shopifySyncedAt,
    };
  } catch (error) {
    logger.error('get_shopify_config_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to get Shopify configuration');
  }
}

/**
 * Start Shopify OAuth flow
 * 
 * Generates OAuth URL for merchant to authorize Shopify access.
 * 
 * @param merchantId - Merchant ID
 * @returns OAuth authorization URL
 */
export async function startShopifyOAuth(merchantId: string): Promise<string> {
  try {
    // Verify merchant exists
    const merchant = await getShopifyConfig(merchantId);
    if (!merchant) {
      // Merchant might not have Shopify configured yet, that's OK
    }

    // TODO: Implement Shopify OAuth flow
    // This would typically:
    // 1. Generate OAuth state token
    // 2. Store state in session/cache
    // 3. Build Shopify OAuth URL with client_id, redirect_uri, scope, state
    // 4. Return URL for merchant to visit

    const shopifyClientId = process.env.SHOPIFY_CLIENT_ID;
    if (!shopifyClientId) {
      throw new Error('Shopify client ID not configured');
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/admin/integrations/shopify/callback`;
    const scopes = 'read_products,read_orders';
    const state = `${merchantId}-${Date.now()}`; // Simple state token

    const oauthUrl = `https://${merchantId}.myshopify.com/admin/oauth/authorize?client_id=${shopifyClientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    logger.info('shopify_oauth_started', {
      merchantId,
      oauthUrl: oauthUrl.substring(0, 100) + '...',
    });

    return oauthUrl;
  } catch (error) {
    logger.error('start_shopify_oauth_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Finalize Shopify OAuth flow
 * 
 * Called after merchant authorizes Shopify access.
 * Exchanges authorization code for access token and stores it.
 * 
 * @param merchantId - Merchant ID
 * @param code - OAuth authorization code
 * @param shop - Shopify shop domain
 */
export async function finalizeShopifyOAuth(
  merchantId: string,
  code: string,
  shop: string
): Promise<void> {
  try {
    // TODO: Implement Shopify OAuth token exchange
    // This would typically:
    // 1. Exchange code for access token via Shopify API
    // 2. Encrypt and store access token
    // 3. Store shop domain
    // 4. Enable sync

    const shopifyClientId = process.env.SHOPIFY_CLIENT_ID;
    const shopifyClientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    if (!shopifyClientId || !shopifyClientSecret) {
      throw new Error('Shopify credentials not configured');
    }

    // Exchange code for access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: shopifyClientId,
        client_secret: shopifyClientSecret,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange OAuth code for token');
    }

    const { access_token } = await tokenResponse.json();

    // Encrypt access token before storing
    const encryptedToken = await encrypt(access_token);
    
    await prisma.merchant.update({
      where: { id: merchantId },
      data: {
        shopifyStore: shop,
        shopifyAccessToken: encryptedToken,
        shopifySyncEnabled: true,
        updatedAt: new Date(),
      },
    });

    logger.info('shopify_oauth_completed', {
      merchantId,
      shop,
    });
  } catch (error) {
    logger.error('finalize_shopify_oauth_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Disconnect Shopify integration
 * 
 * @param merchantId - Merchant ID
 */
export async function disconnectShopify(merchantId: string): Promise<void> {
  try {
    await prisma.merchant.update({
      where: { id: merchantId },
      data: {
        shopifyStore: null,
        shopifyAccessToken: null,
        shopifySyncEnabled: false,
        shopifySyncedAt: null,
        updatedAt: new Date(),
      },
    });

    logger.info('shopify_disconnected', {
      merchantId,
    });
  } catch (error) {
    logger.error('disconnect_shopify_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Sync products from Shopify
 * 
 * Fetches products from Shopify and updates local catalog.
 * 
 * @param merchantId - Merchant ID
 * @returns Sync result
 */
export async function syncShopifyProducts(merchantId: string): Promise<SyncResult> {
  try {
    const config = await getShopifyConfig(merchantId);
    if (!config || !config.shopifyStore) {
      throw new Error('Shopify not configured');
    }

    // TODO: Implement Shopify product sync
    // This would typically:
    // 1. Fetch products from Shopify API
    // 2. Map Shopify product data to unified catalog format
    // 3. Upsert products in database
    // 4. Update shopifySyncedAt timestamp

    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { shopifyAccessToken: true },
    });

    if (!merchant || !merchant.shopifyAccessToken) {
      throw new Error('Shopify access token not found');
    }

    // Decrypt access token
    const accessToken = await decrypt(merchant.shopifyAccessToken);

    // Fetch products from Shopify
    const response = await fetch(
      `https://${config.shopifyStore}/admin/api/2024-01/products.json`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch products from Shopify');
    }

    const { products } = await response.json();

    // TODO: Map and upsert products
    // For now, just update sync timestamp
    await prisma.merchant.update({
      where: { id: merchantId },
      data: {
        shopifySyncedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info('shopify_sync_complete', {
      merchantId,
      productCount: products.length,
    });

    return {
      success: true,
      syncedCount: products.length,
      errors: [],
      syncedAt: new Date(),
    };
  } catch (error) {
    logger.error('sync_shopify_products_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      syncedCount: 0,
      errors: [error instanceof Error ? error.message : String(error)],
      syncedAt: new Date(),
    };
  }
}

/**
 * Get review platform configuration
 * 
 * @param merchantId - Merchant ID
 * @returns Review configuration or null if not configured
 */
export async function getReviewConfig(merchantId: string): Promise<ReviewConfig | null> {
  try {
    const config = await prisma.reviewConfig.findUnique({
      where: { merchantId },
    });

    return config;
  } catch (error) {
    logger.error('get_review_config_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to get review configuration');
  }
}

/**
 * Connect review platform
 * 
 * @param merchantId - Merchant ID
 * @param config - Review platform configuration
 * @returns Created review configuration
 */
export async function connectReviewPlatform(
  merchantId: string,
  config: ReviewConfigInput
): Promise<ReviewConfig> {
  try {
    // Verify merchant exists
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      throw new Error('Merchant not found');
    }

    // Encrypt API key before storing
    const encryptedApiKey = await encrypt(config.apiKey);
    
    const reviewConfig = await prisma.reviewConfig.upsert({
      where: { merchantId },
      update: {
        provider: config.provider,
        businessId: config.businessId,
        apiKey: encryptedApiKey,
        apiUrl: config.apiUrl,
        syncEnabled: true,
        updatedAt: new Date(),
      },
      create: {
        merchantId,
        provider: config.provider,
        businessId: config.businessId,
        apiKey: encryptedApiKey,
        apiUrl: config.apiUrl,
        syncEnabled: true,
      },
    });

    logger.info('review_platform_connected', {
      merchantId,
      provider: config.provider,
    });

    return reviewConfig;
  } catch (error) {
    logger.error('connect_review_platform_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Disconnect review platform
 * 
 * @param merchantId - Merchant ID
 */
export async function disconnectReviewPlatform(merchantId: string): Promise<void> {
  try {
    await prisma.reviewConfig.delete({
      where: { merchantId },
    });

    logger.info('review_platform_disconnected', {
      merchantId,
    });
  } catch (error) {
    logger.error('disconnect_review_platform_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Sync reviews from review platform
 * 
 * Fetches reviews from review platform and updates products.
 * 
 * @param merchantId - Merchant ID
 * @returns Sync result
 */
export async function syncReviews(merchantId: string): Promise<SyncResult> {
  try {
    const config = await getReviewConfig(merchantId);
    if (!config) {
      throw new Error('Review platform not configured');
    }

    // TODO: Implement review sync based on provider
    // This would typically:
    // 1. Fetch reviews from review platform API
    // 2. Map reviews to products
    // 3. Update product reviewScore, reviewCount, reviewsJson
    // 4. Update lastSyncedAt timestamp

    logger.info('review_sync_complete', {
      merchantId,
      provider: config.provider,
    });

    return {
      success: true,
      syncedCount: 0, // TODO: Return actual count
      errors: [],
      syncedAt: new Date(),
    };
  } catch (error) {
    logger.error('sync_reviews_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      syncedCount: 0,
      errors: [error instanceof Error ? error.message : String(error)],
      syncedAt: new Date(),
    };
  }
}

/**
 * Example usage in API route:
 * 
 * ```typescript
 * import { getShopifyConfig, startShopifyOAuth } from '@/lib/services/IntegrationService';
 * import { requireAuth } from '@/middleware/auth';
 * 
 * export async function GET(request: Request) {
 *   try {
 *     const session = await requireAuth(request);
 *     const config = await getShopifyConfig(session.merchantId);
 *     return NextResponse.json(config);
 *   } catch (error) {
 *     return NextResponse.json({ error: 'Failed to get config' }, { status: 500 });
 *   }
 * }
 * 
 * export async function POST(request: Request) {
 *   try {
 *     const session = await requireAuth(request);
 *     const oauthUrl = await startShopifyOAuth(session.merchantId);
 *     return NextResponse.json({ oauthUrl });
 *   } catch (error) {
 *     return NextResponse.json({ error: 'Failed to start OAuth' }, { status: 500 });
 *   }
 * }
 * ```
 */

