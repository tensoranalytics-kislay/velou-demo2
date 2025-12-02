import { NextRequest, NextResponse } from 'next/server';
import { ingestUnifiedCsvStream } from '@/lib/catalog/ingestUnifiedCsv';
import { logger } from '@/lib/telemetry/logger';
import { prisma } from '@/lib/db';
import { Readable } from 'stream';
import type { DatasetContext } from '@/lib/catalog/datasetInspector';
import type { Prisma } from '@prisma/client';

/**
 * POST /api/admin/catalog/upload
 * 
 * Accepts multipart/form-data with:
 * - file: CSV file
 * - vendorId: string
 * 
 * TODO: Add authentication middleware to restrict to admin users
 */
export async function POST(request: NextRequest) {
  try {
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

    // Validate file type
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      return NextResponse.json(
        { error: 'File must be a CSV file' },
        { status: 400 }
      );
    }

    // Convert File to Node.js ReadableStream
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const stream = Readable.from(buffer);

    logger.info('Starting catalog ingestion', {
      vendorId,
      fileName: file.name,
      fileSize: file.size,
      enableContextInference,
      mode,
    });

    const summary = await ingestUnifiedCsvStream(stream, vendorId.trim(), {
      adminHints: {
        vertical: vertical || undefined,
        currency: currency || undefined,
      },
      enableContextInference,
      mode,
    });

    // Truncate issues list to first 100 for response
    const truncatedIssues = summary.issues.slice(0, 100);
    const hasMoreIssues = summary.issues.length > 100;

    logger.info('Catalog ingestion complete', {
      vendorId,
      batchId: summary.batchId,
      mode,
      totalRows: summary.totalRows,
      inserted: summary.inserted,
      updated: summary.updated,
      invalidRows: summary.invalidRows,
      deactivated: summary.deactivated ?? 0,
      totalIssues: summary.issues.length,
      hasDatasetContext: Boolean(summary.datasetContext),
    });

    // Persist DatasetContext to BrandConfig for use in orchestrator
    if (summary.datasetContext) {
      try {
        await prisma.brandConfig.upsert({
          where: { id: 1 },
          update: {
            datasetContext: summary.datasetContext as unknown as Prisma.InputJsonValue,
          },
          create: {
            id: 1,
            brandName: 'Default Brand',
            primaryColor: '#000000',
            accentColor: '#000000',
            voiceInstructions: 'Be helpful and friendly.',
            toneFormal: 5,
            tonePlayful: 5,
            createdAt: new Date(),
            updatedAt: new Date(),
            datasetContext: summary.datasetContext as unknown as Prisma.InputJsonValue,
          },
        });
        logger.info('DatasetContext persisted to BrandConfig', {
          vertical: summary.datasetContext.vertical,
          primaryFacets: summary.datasetContext.primaryFacets,
          recommendedSearchExamples: summary.datasetContext.recommendedSearchExamples,
          sampleCategories: summary.datasetContext.sampleCategories,
        });
        
        // Console log for immediate visibility
        console.log('[upload] DatasetContext persisted:', {
          vertical: summary.datasetContext.vertical,
          recommendedSearchExamples: summary.datasetContext.recommendedSearchExamples,
          sampleCategories: summary.datasetContext.sampleCategories,
        });
      } catch (error) {
        logger.warn('Failed to persist DatasetContext to BrandConfig', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't fail the upload if context persistence fails
      }
    }

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

