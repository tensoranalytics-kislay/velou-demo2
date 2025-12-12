#!/usr/bin/env tsx
/**
 * Inspect product_details structure
 */

import { prisma } from '../src/lib/db';
import { Prisma } from '@prisma/client';

async function inspect() {
  const product = await prisma.product.findFirst({
    where: {
      isActive: true,
      attributes: {
        path: ['product_details'],
        not: Prisma.AnyNull,
      },
    },
    select: {
      id: true,
      title: true,
      attributes: true,
    },
  });

  if (!product) {
    console.log('No product found with product_details');
    return;
  }

  console.log('Product ID:', product.id);
  console.log('Title:', product.title);
  console.log('\nAttributes structure:');
  console.log(JSON.stringify(product.attributes, null, 2));
}

inspect()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

