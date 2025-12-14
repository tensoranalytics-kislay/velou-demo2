#!/usr/bin/env tsx
/**
 * Check products that don't have loccitaneStructured yet
 */

import { prisma } from '../src/lib/db';
import { Prisma } from '@prisma/client';

async function checkRemaining() {
  try {
    // Products without loccitaneStructured
    const withoutStructured = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          {
            attributes: {
              path: ['loccitaneStructured'],
              equals: Prisma.AnyNull,
            },
          },
          {
            NOT: {
              attributes: {
                path: ['loccitaneStructured'],
                not: Prisma.AnyNull,
              },
            },
          },
        ],
      },
      take: 10,
      select: {
        id: true,
        title: true,
        attributes: true,
      },
    });

    console.log(`📊 Products without loccitaneStructured: ${withoutStructured.length}\n`);

    if (withoutStructured.length === 0) {
      console.log('✅ All products that can have loccitaneStructured already have it!');
      return;
    }

    console.log('Sample products:\n');
    for (const product of withoutStructured.slice(0, 5)) {
      const attrs = product.attributes as any;
      console.log(`\nProduct: ${product.title}`);
      console.log(`ID: ${product.id}`);
      console.log(`Has product_details: ${!!(attrs?.product_details || attrs?.productDetails)}`);
      if (attrs?.product_details || attrs?.productDetails) {
        const pd = attrs.product_details || attrs.productDetails;
        if (typeof pd === 'object') {
          console.log(`  Type: ${typeof pd}`);
          console.log(`  Keys: ${Object.keys(pd).join(', ')}`);
        } else if (Array.isArray(pd)) {
          console.log(`  Type: Array with ${pd.length} items`);
        } else {
          console.log(`  Type: ${typeof pd}`);
        }
      } else {
        console.log('  No product_details found');
      }
    }

    // Count how many have product_details but no structured
    const withDetailsButNoStructured = await prisma.product.count({
      where: {
        isActive: true,
        OR: [
          { attributes: { path: ['product_details'], not: Prisma.AnyNull } },
          { attributes: { path: ['productDetails'], not: Prisma.AnyNull } },
        ],
        OR: [
          {
            attributes: {
              path: ['loccitaneStructured'],
              equals: Prisma.AnyNull,
            },
          },
          {
            NOT: {
              attributes: {
                path: ['loccitaneStructured'],
                not: Prisma.AnyNull,
              },
            },
          },
        ],
      },
    });

    console.log(`\n\nProducts with product_details but no structured: ${withDetailsButNoStructured}`);
    
    if (withDetailsButNoStructured > 0) {
      console.log('⚠️  Running backfill will process these products...');
    } else {
      console.log('ℹ️  All products with product_details already have structured attributes.');
    }

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

checkRemaining()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });




