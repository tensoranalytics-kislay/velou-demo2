#!/usr/bin/env tsx
/**
 * Show L'Occitane Structured Attributes for sample products
 */

import { prisma } from '../src/lib/db';
import { Prisma } from '@prisma/client';

async function showAttributes() {
  try {
    // Get a few sample products with structured attributes
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        attributes: {
          path: ['loccitaneStructured'],
          not: Prisma.AnyNull,
        },
      },
      take: 3,
      select: {
        id: true,
        title: true,
        attributes: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    if (products.length === 0) {
      console.log('No products with structured attributes found.');
      return;
    }

    console.log('📋 Sample L\'Occitane Structured Attributes\n');
    console.log('='.repeat(80));

    for (const product of products) {
      const attrs = product.attributes as any;
      const structured = attrs?.loccitaneStructured;

      if (!structured) continue;

      console.log(`\n🛍️  Product: ${product.title}`);
      console.log(`   ID: ${product.id}`);
      console.log('-'.repeat(80));

      if (structured.concerns && structured.concerns.length > 0) {
        console.log(`\n   Concerns (${structured.concerns.length}):`);
        structured.concerns.forEach((c: string) => console.log(`     • ${c}`));
      }

      if (structured.canonicalConcerns && structured.canonicalConcerns.length > 0) {
        console.log(`\n   Canonical Concerns (${structured.canonicalConcerns.length}):`);
        structured.canonicalConcerns.forEach((c: string) => console.log(`     • ${c}`));
      }

      if (structured.skinTypes && structured.skinTypes.length > 0) {
        console.log(`\n   Skin Types (${structured.skinTypes.length}):`);
        structured.skinTypes.forEach((s: string) => console.log(`     • ${s}`));
      }

      if (structured.hairTypes && structured.hairTypes.length > 0) {
        console.log(`\n   Hair Types (${structured.hairTypes.length}):`);
        structured.hairTypes.forEach((h: string) => console.log(`     • ${h}`));
      }

      if (structured.applicationAreas && structured.applicationAreas.length > 0) {
        console.log(`\n   Application Areas (${structured.applicationAreas.length}):`);
        structured.applicationAreas.forEach((a: string) => console.log(`     • ${a}`));
      }

      if (structured.productType) {
        console.log(`\n   Product Type: ${structured.productType}`);
      }

      if (structured.formula) {
        console.log(`   Formula: ${structured.formula}`);
      }

      if (structured.featuredIngredients && structured.featuredIngredients.length > 0) {
        console.log(`\n   Featured Ingredients (${structured.featuredIngredients.length}):`);
        structured.featuredIngredients.slice(0, 10).forEach((i: string) => console.log(`     • ${i}`));
        if (structured.featuredIngredients.length > 10) {
          console.log(`     ... and ${structured.featuredIngredients.length - 10} more`);
        }
      }

      if (structured.allIngredients && structured.allIngredients.length > 0) {
        console.log(`\n   All Ingredients (${structured.allIngredients.length} total):`);
        structured.allIngredients.slice(0, 10).forEach((i: string) => console.log(`     • ${i}`));
        if (structured.allIngredients.length > 10) {
          console.log(`     ... and ${structured.allIngredients.length - 10} more`);
        }
      }

      if (structured.canonicalIngredients && structured.canonicalIngredients.length > 0) {
        console.log(`\n   Canonical Ingredients (${structured.canonicalIngredients.length}):`);
        structured.canonicalIngredients.slice(0, 10).forEach((i: string) => console.log(`     • ${i}`));
        if (structured.canonicalIngredients.length > 10) {
          console.log(`     ... and ${structured.canonicalIngredients.length - 10} more`);
        }
      }

      if (structured.madeWithout && structured.madeWithout.length > 0) {
        console.log(`\n   Made Without (${structured.madeWithout.length}):`);
        structured.madeWithout.forEach((m: string) => console.log(`     • ${m}`));
      }

      if (structured.ageGroups && structured.ageGroups.length > 0) {
        console.log(`\n   Age Groups (${structured.ageGroups.length}):`);
        structured.ageGroups.forEach((a: string) => console.log(`     • ${a}`));
      }

      if (structured.genders && structured.genders.length > 0) {
        console.log(`\n   Genders (${structured.genders.length}):`);
        structured.genders.forEach((g: string) => console.log(`     • ${g}`));
      }

      console.log('\n' + '='.repeat(80));
    }

    // Show summary of all attribute types
    console.log('\n📊 Summary of All Attribute Types:\n');
    console.log('='.repeat(80));

    const allProducts = await prisma.product.findMany({
      where: {
        isActive: true,
        attributes: {
          path: ['loccitaneStructured'],
          not: Prisma.AnyNull,
        },
      },
      select: {
        attributes: true,
      },
    });

    const attributeCounts = {
      concerns: new Set<string>(),
      canonicalConcerns: new Set<string>(),
      skinTypes: new Set<string>(),
      hairTypes: new Set<string>(),
      applicationAreas: new Set<string>(),
      productTypes: new Set<string>(),
      formulas: new Set<string>(),
      featuredIngredients: new Set<string>(),
      allIngredients: new Set<string>(),
      canonicalIngredients: new Set<string>(),
      madeWithout: new Set<string>(),
      ageGroups: new Set<string>(),
      genders: new Set<string>(),
    };

    for (const product of allProducts) {
      const attrs = product.attributes as any;
      const structured = attrs?.loccitaneStructured;
      if (!structured) continue;

      structured.concerns?.forEach((c: string) => attributeCounts.concerns.add(c));
      structured.canonicalConcerns?.forEach((c: string) => attributeCounts.canonicalConcerns.add(c));
      structured.skinTypes?.forEach((s: string) => attributeCounts.skinTypes.add(s));
      structured.hairTypes?.forEach((h: string) => attributeCounts.hairTypes.add(h));
      structured.applicationAreas?.forEach((a: string) => attributeCounts.applicationAreas.add(a));
      if (structured.productType) attributeCounts.productTypes.add(structured.productType);
      if (structured.formula) attributeCounts.formulas.add(structured.formula);
      structured.featuredIngredients?.forEach((i: string) => attributeCounts.featuredIngredients.add(i));
      structured.allIngredients?.forEach((i: string) => attributeCounts.allIngredients.add(i));
      structured.canonicalIngredients?.forEach((i: string) => attributeCounts.canonicalIngredients.add(i));
      structured.madeWithout?.forEach((m: string) => attributeCounts.madeWithout.add(m));
      structured.ageGroups?.forEach((a: string) => attributeCounts.ageGroups.add(a));
      structured.genders?.forEach((g: string) => attributeCounts.genders.add(g));
    }

    console.log(`Unique Concerns: ${attributeCounts.concerns.size}`);
    console.log(`Unique Canonical Concerns: ${attributeCounts.canonicalConcerns.size}`);
    console.log(`Unique Skin Types: ${attributeCounts.skinTypes.size}`);
    console.log(`Unique Hair Types: ${attributeCounts.hairTypes.size}`);
    console.log(`Unique Application Areas: ${attributeCounts.applicationAreas.size}`);
    console.log(`Unique Product Types: ${attributeCounts.productTypes.size}`);
    console.log(`Unique Formulas: ${attributeCounts.formulas.size}`);
    console.log(`Unique Featured Ingredients: ${attributeCounts.featuredIngredients.size}`);
    console.log(`Unique All Ingredients: ${attributeCounts.allIngredients.size}`);
    console.log(`Unique Canonical Ingredients: ${attributeCounts.canonicalIngredients.size}`);
    console.log(`Unique Made Without: ${attributeCounts.madeWithout.size}`);
    console.log(`Unique Age Groups: ${attributeCounts.ageGroups.size}`);
    console.log(`Unique Genders: ${attributeCounts.genders.size}`);

    console.log('\n' + '='.repeat(80));
    console.log('\nSample values:\n');

    if (attributeCounts.concerns.size > 0) {
      console.log('Sample Concerns:', Array.from(attributeCounts.concerns).slice(0, 10).join(', '));
    }
    if (attributeCounts.canonicalConcerns.size > 0) {
      console.log('Sample Canonical Concerns:', Array.from(attributeCounts.canonicalConcerns).slice(0, 10).join(', '));
    }
    if (attributeCounts.skinTypes.size > 0) {
      console.log('Sample Skin Types:', Array.from(attributeCounts.skinTypes).join(', '));
    }
    if (attributeCounts.hairTypes.size > 0) {
      console.log('Sample Hair Types:', Array.from(attributeCounts.hairTypes).join(', '));
    }
    if (attributeCounts.applicationAreas.size > 0) {
      console.log('Sample Application Areas:', Array.from(attributeCounts.applicationAreas).join(', '));
    }
    if (attributeCounts.productTypes.size > 0) {
      console.log('Sample Product Types:', Array.from(attributeCounts.productTypes).slice(0, 15).join(', '));
    }
    if (attributeCounts.formulas.size > 0) {
      console.log('Sample Formulas:', Array.from(attributeCounts.formulas).join(', '));
    }
    if (attributeCounts.madeWithout.size > 0) {
      console.log('Sample Made Without:', Array.from(attributeCounts.madeWithout).join(', '));
    }

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

showAttributes()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });






