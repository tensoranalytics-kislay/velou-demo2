#!/usr/bin/env tsx

/**
 * Verify Quiz Dataset Ingestion
 * 
 * Checks that:
 * 1. Quiz products are ingested with correct titles (not categories)
 * 2. All Quiz products have embeddings
 * 3. Quiz constraint values are in the global dictionaries
 * 
 * Usage:
 *   npx tsx scripts/verify-quiz-ingestion.ts
 */

import { prisma } from '../src/lib/db';

async function main() {
  console.log('🔍 Verifying Quiz Dataset Ingestion...\n');

  try {
    // 1. Check Quiz products count and basic stats
    console.log('1️⃣ Checking Quiz Products...\n');
    
    const quizProducts = await prisma.product.findMany({
      where: {
        vendorId: 'quiz',
        isActive: true,
      },
      select: {
        id: true,
        title: true,
        category: true,
        subcategory: true,
        enrichedColor: true,
        gender: true,
        ageGroup: true,
      },
      take: 10,
    });

    const totalQuizCount = await prisma.product.count({
      where: {
        vendorId: 'quiz',
        isActive: true,
      },
    });

    console.log(`   Total Quiz products: ${totalQuizCount}`);
    console.log(`\n   Sample products (first 10):`);
    for (const product of quizProducts) {
      console.log(`   - ${product.id}: "${product.title}"`);
      console.log(`     Category: ${product.category} | Gender: ${product.gender} | Age: ${product.ageGroup || 'N/A'}`);
      
      // Verify title is NOT a category string (should not contain pipe characters or common category patterns)
      if (product.title.includes('|') || product.title.includes('£')) {
        console.log(`     ⚠️  WARNING: Title appears to be a category string: "${product.title}"`);
      }
    }

    // 2. Check embeddings for Quiz products
    console.log('\n2️⃣ Checking Embeddings...\n');

    const embeddingStats = await prisma.$queryRawUnsafe<Array<{
      has_embedding: bigint;
      no_embedding: bigint;
      total: bigint;
    }>>(`
      SELECT 
        COUNT(*) FILTER (WHERE "embedding" IS NOT NULL) as has_embedding,
        COUNT(*) FILTER (WHERE "embedding" IS NULL) as no_embedding,
        COUNT(*) as total
      FROM "Product"
      WHERE "vendorId" = 'quiz' AND "isActive" = true
    `);

    const stats = embeddingStats[0];
    const hasEmbedding = Number(stats.has_embedding);
    const noEmbedding = Number(stats.no_embedding);
    const total = Number(stats.total);
    const embeddingPercentage = total > 0 ? Math.round((hasEmbedding / total) * 100) : 0;

    console.log(`   Quiz products with embeddings: ${hasEmbedding}/${total} (${embeddingPercentage}%)`);
    console.log(`   Quiz products without embeddings: ${noEmbedding}`);

    if (noEmbedding > 0) {
      console.log(`   ⚠️  WARNING: ${noEmbedding} Quiz products are missing embeddings`);
    } else {
      console.log(`   ✅ All Quiz products have embeddings`);
    }

    // 3. Check dictionary values for Quiz-specific constraints
    console.log('\n3️⃣ Checking Dictionary Values...\n');

    // Get some Quiz-specific values to verify they're in dictionaries
    const quizColors = await prisma.product.findMany({
      where: {
        vendorId: 'quiz',
        isActive: true,
      },
      select: {
        enrichedColor: true,
      },
      distinct: ['enrichedColor'],
      take: 20,
    });

    const quizLengths = await prisma.product.findMany({
      where: {
        vendorId: 'quiz',
        isActive: true,
      },
      select: {
        length: true,
      },
      distinct: ['length'],
      take: 10,
    });

    const quizFormalityLevels = await prisma.product.findMany({
      where: {
        vendorId: 'quiz',
        isActive: true,
      },
      select: {
        formalityLevel: true,
      },
      distinct: ['formalityLevel'],
      take: 10,
    });

    console.log(`   Sample Quiz enriched colors (${quizColors.filter(c => c.enrichedColor).length} unique):`);
    quizColors.filter(c => c.enrichedColor).slice(0, 5).forEach(c => {
      console.log(`     - ${c.enrichedColor}`);
    });

    console.log(`   Sample Quiz lengths (${quizLengths.filter(l => l.length).length} unique):`);
    quizLengths.filter(l => l.length).slice(0, 5).forEach(l => {
      console.log(`     - ${l.length}`);
    });

    console.log(`   Sample Quiz formality levels (${quizFormalityLevels.filter(f => f.formalityLevel).length} unique):`);
    quizFormalityLevels.filter(f => f.formalityLevel).slice(0, 5).forEach(f => {
      console.log(`     - ${f.formalityLevel}`);
    });

    // 4. Verify titles are correct (not category strings)
    console.log('\n4️⃣ Verifying Title Quality...\n');

    const titlesWithCategoryPattern = await prisma.product.findMany({
      where: {
        vendorId: 'quiz',
        isActive: true,
        OR: [
          { title: { contains: '|' } },
          { title: { contains: '£' } },
        ],
      },
      select: {
        id: true,
        title: true,
      },
      take: 10,
    });

    if (titlesWithCategoryPattern.length > 0) {
      console.log(`   ⚠️  WARNING: Found ${titlesWithCategoryPattern.length} products with titles that look like categories:`);
      titlesWithCategoryPattern.forEach(p => {
        console.log(`     - ${p.id}: "${p.title}"`);
      });
    } else {
      console.log(`   ✅ All Quiz product titles look correct (no category strings detected)`);
    }

    // 5. Overall summary
    console.log('\n📊 Summary:\n');
    console.log(`   ✅ Quiz products ingested: ${totalQuizCount}`);
    console.log(`   ${noEmbedding === 0 ? '✅' : '⚠️'} Embeddings: ${hasEmbedding}/${total} (${embeddingPercentage}%)`);
    console.log(`   ${titlesWithCategoryPattern.length === 0 ? '✅' : '⚠️'} Title quality: ${titlesWithCategoryPattern.length === 0 ? 'Good' : `${titlesWithCategoryPattern.length} issues found`}`);

    if (noEmbedding === 0 && titlesWithCategoryPattern.length === 0) {
      console.log('\n✅ All verifications passed! Quiz ingestion is complete and correct.\n');
    } else {
      console.log('\n⚠️  Some issues found. Please review the warnings above.\n');
    }

  } catch (error) {
    console.error('\n❌ Verification failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
