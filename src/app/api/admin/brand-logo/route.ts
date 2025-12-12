import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { requireAuth, createAuthErrorResponse } from '@/middleware/auth';
import { requireRoleForRequest } from '@/middleware/requireRole';
import { updateMerchantProfile } from '@/lib/services/MerchantService';
import { logger } from '@/lib/telemetry/logger';
import { validateFile, ALLOWED_IMAGE_TYPES } from '@/lib/fileValidator';

/**
 * POST /api/admin/brand-logo
 *
 * Accepts multipart/form-data with:
 * - file: image file to use as the brand logo
 *
 * Saves the file into /public and updates Merchant.logoUrl
 * so the rest of the app can reference it.
 *
 * NOTE: This is a simple demo implementation using local filesystem storage.
 * In production, you may want to upload to object storage (S3, GCS, etc.).
 *
 * Requires authentication (ADMIN or EDITOR can upload logos)
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require ADMIN or EDITOR role for logo uploads
    const session = await requireRoleForRequest(request, ['ADMIN', 'EDITOR']);
    
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // SECURITY: Validate file with security checks (blocks SVG, enforces size limits)
    const fileValidation = validateFile(file, ALLOWED_IMAGE_TYPES);
    if (!fileValidation.valid) {
      return NextResponse.json(
        { error: fileValidation.error || 'File validation failed' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const uploadsDir = path.join(process.cwd(), 'public');

    // Derive extension from original file name (fallback to .png)
    // SECURITY: Only allow safe image extensions (SVG already blocked by validateFile)
    const origName = file.name || 'brand-logo.png';
    const ext = path.extname(origName) || '.png';
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext.toLowerCase())
      ? ext
      : '.png';

    const fileName = `brand-logo${safeExt}`;
    const filePath = path.join(uploadsDir, fileName);

    await fs.writeFile(filePath, buffer);

    const logoUrl = `/${fileName}`;

    // Use MerchantService to update logo
    const { updateMerchantProfile } = await import('@/lib/services/MerchantService');
    await updateMerchantProfile(session.merchantId, {
      logoUrl,
    });

    logger.info('brand_logo_uploaded', {
      userId: session.userId,
      merchantId: session.merchantId,
      logoUrl,
    });

    return NextResponse.json({ logoUrl });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('brand_logo_upload_failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 });
  }
}


