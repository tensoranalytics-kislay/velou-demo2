import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * POST /api/admin/brand-logo
 *
 * Accepts multipart/form-data with:
 * - file: image file to use as the brand logo
 *
 * Saves the file into /public and updates BrandConfig.logoUrl
 * so the rest of the app can reference it.
 *
 * NOTE: This is a simple demo implementation using local filesystem storage.
 * In production, you may want to upload to object storage (S3, GCS, etc.).
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Basic validation on file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const uploadsDir = path.join(process.cwd(), 'public');

    // Derive extension from original file name (fallback to .png)
    const origName = file.name || 'brand-logo.png';
    const ext = path.extname(origName) || '.png';
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext.toLowerCase())
      ? ext
      : '.png';

    const fileName = `brand-logo${safeExt}`;
    const filePath = path.join(uploadsDir, fileName);

    await fs.writeFile(filePath, buffer);

    const logoUrl = `/${fileName}`;

    await prisma.brandConfig.upsert({
      where: { id: 1 },
      update: {
        logoUrl,
        updatedAt: new Date(),
      },
      create: {
        id: 1,
        brandName: 'Velou Atelier',
        primaryColor: '#e11d48',
        accentColor: '#f97373',
        backgroundColor: '#ffffff',
        surfaceColor: '#fff7f7',
        borderColor: '#ffe4e6',
        logoUrl,
        voiceInstructions: 'Be helpful and warm.',
        toneFormal: 5,
        tonePlayful: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ logoUrl });
  } catch (error) {
    console.error('Failed to upload brand logo:', error);
    return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 });
  }
}


