import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/telemetry/logger';
import { requireAuth, createAuthErrorResponse } from '@/middleware/auth';
import { requireRoleForRequest } from '@/middleware/requireRole';
import { importCatalogCSV } from '@/lib/services/CatalogService';
import { validateFile, validateCsvStructure, ALLOWED_CSV_TYPES } from '@/lib/fileValidator';

/**
 * POST /api/admin/catalog/upload
 * 
 * Accepts multipart/form-data with:
 * - file: CSV file
 * - vendorId: string
 * 
 * Requires authentication (ADMIN or EDITOR role)
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require ADMIN or EDITOR role for catalog uploads
    const session = await requireRoleForRequest(request, ['ADMIN', 'EDITOR']);
    
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const vendorId = formData.get('vendorId') as string | null;
    const vertical = formData.get('vertical') as string | null;
    const currency = formData.get('currency') as string | null;
    const enableContextInference = formData.get('enableContextInference') !== 'false'; // Default true
    const mode = (formData.get('mode') as 'FULL_REPLACE' | 'INCREMENTAL' | null) || 'FULL_REPLACE';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!vendorId || vendorId.trim() === '') {
      return NextResponse.json({ error: 'vendorId is required' }, { status: 400 });
    }

    // SECURITY: Validate file with security checks
    const fileValidation = validateFile(file, ALLOWED_CSV_TYPES);
    if (!fileValidation.valid) {
      return NextResponse.json(
        { error: fileValidation.error || 'File validation failed' },
        { status: 400 }
      );
    }

    // Additional CSV-specific validation
    if (!file.name.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'File must have .csv extension' },
        { status: 400 }
      );
    }

    logger.info('Starting catalog ingestion', {
      userId: session.userId,
      merchantId: session.merchantId,
      vendorId,
      fileName: file.name,
      fileSize: file.size,
      enableContextInference,
      mode,
    });

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // SECURITY: Validate CSV structure before processing
    const csvValidation = await validateCsvStructure(buffer);
    if (!csvValidation.valid) {
      return NextResponse.json(
        { error: csvValidation.error || 'Invalid CSV structure' },
        { status: 400 }
      );
    }

    // Use CatalogService to import catalog (automatically handles merchantId and datasetContext)
    const summary = await importCatalogCSV(
      session.merchantId,
      buffer,
      mode,
      {
        vendorId: vendorId.trim(),
        vertical: vertical || undefined,
        currency: currency || undefined,
        enableContextInference,
      }
    );

    // Truncate issues list to first 100 for response
    const truncatedIssues = summary.issues.slice(0, 100);
    const hasMoreIssues = summary.issues.length > 100;

    return NextResponse.json({
      summary: {
        ...summary,
        issues: truncatedIssues,
        _meta: {
          totalIssues: summary.issues.length,
          issuesTruncated: hasMoreIssues,
        },
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('Catalog upload failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        error: 'Failed to process catalog upload',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

