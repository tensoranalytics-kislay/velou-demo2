#!/usr/bin/env tsx

/**
 * Check embedding backfill status for active products.
 */

import { prisma } from '../src/lib/db';

async function main() {
  const rows = await prisma.$queryRawUnsafe<{
    with_embeddings: bigint;
    without_embeddings: bigint;
    total: bigint;
  }[]>(`
    SELECT 
      COUNT(*) FILTER (WHERE "embedding" IS NOT NULL) as with_embeddings,
      COUNT(*) FILTER (WHERE "embedding" IS NULL) as without_embeddings,
      COUNT(*) as total
    FROM "Product"
    WHERE "isActive" = true
  `);

  const s = rows[0];
  console.log('with_embeddings', s.with_embeddings.toString());
  console.log('without_embeddings', s.without_embeddings.toString());
  console.log('total', s.total.toString());

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('ERROR', err);
  process.exit(1);
});

