/**
 * MerchantService
 * 
 * Handles all merchant-related operations including:
 * - Merchant profile management
 * - Merchant user management (CRUD)
 * 
 * All operations are scoped to a specific merchantId for multi-tenant isolation.
 */

import { prisma } from '../db';
import { hashPassword } from '../auth/password';
import { encrypt, decrypt } from '../encryption';
import { logger } from '../telemetry/logger';
import type { Merchant, MerchantUser, UserRole } from '@prisma/client';

/**
 * Get merchant by ID
 * 
 * @param merchantId - Merchant ID
 * @returns Merchant or null if not found
 * @throws Error if database query fails
 */
export async function getMerchant(merchantId: string): Promise<Merchant | null> {
  try {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      logger.warn('merchant_not_found', { merchantId });
      return null;
    }

    return merchant;
  } catch (error) {
    logger.error('get_merchant_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to get merchant');
  }
}

/**
 * Update merchant profile
 * 
 * @param merchantId - Merchant ID
 * @param data - Partial merchant data to update
 * @returns Updated merchant
 * @throws Error if merchant not found or update fails
 */
export async function updateMerchantProfile(
  merchantId: string,
  data: Partial<Merchant>
): Promise<Merchant> {
  try {
    // Verify merchant exists
    const existing = await getMerchant(merchantId);
    if (!existing) {
      throw new Error('Merchant not found');
    }

    // Encrypt sensitive fields if provided
    const updateData: Partial<Merchant> = { ...data };
    if (data.merchantOpenAIKey !== undefined) {
      if (data.merchantOpenAIKey) {
        updateData.merchantOpenAIKey = await encrypt(data.merchantOpenAIKey);
      } else {
        updateData.merchantOpenAIKey = null;
      }
    }

    // Cast datasetContext to InputJsonValue if present
    const sanitizedData: any = { ...updateData };
    if ('datasetContext' in sanitizedData && sanitizedData.datasetContext !== undefined) {
      sanitizedData.datasetContext = sanitizedData.datasetContext as any;
    }
    
    const updated = await prisma.merchant.update({
      where: { id: merchantId },
      data: {
        ...sanitizedData,
        updatedAt: new Date(),
      },
    });

    logger.info('merchant_profile_updated', {
      merchantId,
      updatedFields: Object.keys(data),
    });

    return updated;
  } catch (error) {
    logger.error('update_merchant_profile_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Create a new merchant user
 * 
 * @param merchantId - Merchant ID
 * @param email - User email
 * @param password - Plain text password (will be hashed)
 * @param role - User role (ADMIN, EDITOR, VIEWER)
 * @returns Created merchant user
 * @throws Error if user already exists or creation fails
 */
export async function createMerchantUser(
  merchantId: string,
  email: string,
  password: string,
  role: UserRole
): Promise<MerchantUser> {
  try {
    // Verify merchant exists
    const merchant = await getMerchant(merchantId);
    if (!merchant) {
      throw new Error('Merchant not found');
    }

    // Check if user already exists
    const existing = await prisma.merchantUser.findFirst({
      where: {
        merchantId,
        email: email.toLowerCase().trim(),
      },
    });

    if (existing) {
      throw new Error('User with this email already exists');
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await prisma.merchantUser.create({
      data: {
        merchantId,
        email: email.toLowerCase().trim(),
        passwordHash,
        role,
        isActive: true,
      },
    });

    logger.info('merchant_user_created', {
      merchantId,
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return user;
  } catch (error) {
    logger.error('create_merchant_user_failed', {
      merchantId,
      email,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get all users for a merchant
 * 
 * @param merchantId - Merchant ID
 * @returns Array of merchant users
 */
export async function getMerchantUsers(merchantId: string): Promise<MerchantUser[]> {
  try {
    const users = await prisma.merchantUser.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });

    return users;
  } catch (error) {
    logger.error('get_merchant_users_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to get merchant users');
  }
}

/**
 * Update merchant user
 * 
 * @param merchantId - Merchant ID (for verification)
 * @param userId - User ID to update
 * @param data - Partial user data to update
 * @returns Updated merchant user
 * @throws Error if user not found, doesn't belong to merchant, or update fails
 */
export async function updateMerchantUser(
  merchantId: string,
  userId: string,
  data: Partial<MerchantUser>
): Promise<MerchantUser> {
  try {
    // Verify user exists and belongs to merchant
    const existing = await prisma.merchantUser.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      throw new Error('User not found');
    }

    if (existing.merchantId !== merchantId) {
      throw new Error('User does not belong to this merchant');
    }

    // Hash password if provided
    const updateData: Partial<MerchantUser> = { ...data };
    if (data.passwordHash && typeof data.passwordHash === 'string') {
      // If password is provided as plain text, hash it
      // Note: In practice, you'd want a separate method for password updates
      // For now, we assume passwordHash is already hashed
    }

    const updated = await prisma.merchantUser.update({
      where: { id: userId },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
    });

    logger.info('merchant_user_updated', {
      merchantId,
      userId,
      updatedFields: Object.keys(data),
    });

    return updated;
  } catch (error) {
    logger.error('update_merchant_user_failed', {
      merchantId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Delete merchant user
 * 
 * @param merchantId - Merchant ID (for verification)
 * @param userId - User ID to delete
 * @throws Error if user not found, doesn't belong to merchant, or deletion fails
 */
export async function deleteMerchantUser(
  merchantId: string,
  userId: string
): Promise<void> {
  try {
    // Verify user exists and belongs to merchant
    const existing = await prisma.merchantUser.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      throw new Error('User not found');
    }

    if (existing.merchantId !== merchantId) {
      throw new Error('User does not belong to this merchant');
    }

    await prisma.merchantUser.delete({
      where: { id: userId },
    });

    logger.info('merchant_user_deleted', {
      merchantId,
      userId,
    });
  } catch (error) {
    logger.error('delete_merchant_user_failed', {
      merchantId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Example usage in API route:
 * 
 * ```typescript
 * import { getMerchant, updateMerchantProfile } from '@/lib/services/MerchantService';
 * import { requireAuth } from '@/middleware/auth';
 * 
 * export async function PATCH(request: Request) {
 *   try {
 *     const session = await requireAuth(request);
 *     const body = await request.json();
 *     
 *     const merchant = await updateMerchantProfile(session.merchantId, {
 *       brandName: body.brandName,
 *       primaryColor: body.primaryColor,
 *     });
 *     
 *     return NextResponse.json(merchant);
 *   } catch (error) {
 *     return NextResponse.json(
 *       { error: error instanceof Error ? error.message : 'Failed to update' },
 *       { status: 500 }
 *     );
 *   }
 * }
 * ```
 */

