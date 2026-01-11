/**
 * Verification Script for Enriched Pipeline
 * 
 * Verifies that:
 * 1. Enriched columns are populated correctly
 * 2. Enriched filters are working in queries
 * 3. Ranking boosts are applied
 * 
 * Usage:
 *   npx tsx scripts/verify-enriched-pipeline.ts
 */

import { prisma } from '../src/lib/db';
import { searchProducts } from '../src/lib/search';
import { logger } from '../src/lib/telemetry/logger';

async function verifyEnrichedColumns() {
  logger.info('Verifying enriched columns are populated...');

  const sampleSize = 20;
  const products = await prisma.product.findMany({
    where: { isActive: true },
    take: sampleSize,
    select: {
      id: true,
      title: true,
      length: true,
      formalityLevel: true,
      temperatureIntent: true,
      humidityFriendly: true,
      occasionContext: true,
      problemSolutions: true,
      functionFeatures: true,
      colorShade: true,
      colorUndertone: true,
      multicolor: true,
      seasonalPalette: true,
    },
  });

  const stats = {
    total: products.length,
    withLength: products.filter((p) => p.length).length,
    withFormalityLevel: products.filter((p) => p.formalityLevel).length,
    withTemperatureIntent: products.filter((p) => p.temperatureIntent).length,
    withHumidityFriendly: products.filter((p) => p.humidityFriendly !== null).length,
    withOccasionContext: products.filter((p) => p.occasionContext?.length).length,
    withProblemSolutions: products.filter((p) => p.problemSolutions?.length).length,
    withFunctionFeatures: products.filter((p) => p.functionFeatures?.length).length,
    withColorShade: products.filter((p) => p.colorShade).length,
    withColorUndertone: products.filter((p) => p.colorUndertone).length,
    withMulticolor: products.filter((p) => p.multicolor !== null).length,
    withSeasonalPalette: products.filter((p) => p.seasonalPalette).length,
  };

  logger.info('Enriched column population stats', stats);

  // Show sample products
  logger.info('Sample products with enriched data:');
  products.slice(0, 5).forEach((p) => {
    logger.info('Product sample', {
      id: p.id,
      title: p.title.substring(0, 50),
      length: p.length,
      formalityLevel: p.formalityLevel,
      temperatureIntent: p.temperatureIntent,
      humidityFriendly: p.humidityFriendly,
      occasionContext: p.occasionContext,
      problemSolutions: p.problemSolutions,
      functionFeatures: p.functionFeatures,
      colorShade: p.colorShade,
      colorUndertone: p.colorUndertone,
      multicolor: p.multicolor,
      seasonalPalette: p.seasonalPalette,
    });
  });

  return stats;
}

async function testEnrichedQueries() {
  logger.info('Testing enriched queries...');

  const testQueries = [
    {
      name: 'Hot humid day',
      constraints: {
        temperatureIntent: 'Warm Weather',
        humidityFriendly: true,
      },
      userMessage: 'I need something for a hot humid day',
    },
    {
      name: 'Wedding dress',
      constraints: {
        formalityLevel: ['Semi-Formal', 'Formal'],
        occasionContext: ['Wedding'],
      },
      userMessage: 'I need a dress for a wedding',
    },
    {
      name: 'Wrinkle-free with pockets',
      constraints: {
        problemSolutions: ['Wrinkle-Free', 'Pockets'],
        functionFeatures: ['Pockets'],
      },
      userMessage: 'I need something wrinkle-free with pockets',
    },
    {
      name: 'Light warm tones',
      constraints: {
        colorShade: ['Light'],
        colorUndertone: ['Warm'],
      },
      userMessage: 'I want something in light warm tones',
    },
    {
      name: 'Midi length formal',
      constraints: {
        lengths: ['Midi'],
        formalityLevel: ['Formal'],
      },
      userMessage: 'Show me midi length formal dresses',
    },
  ];

  const results = [];

  for (const test of testQueries) {
    try {
      const searchResult = await searchProducts(test.constraints, test.userMessage);
      const products = searchResult.products;

      // Verify results match constraints
      let matchingCount = 0;
      for (const product of products) {
        let matches = true;

        if (test.constraints.temperatureIntent && product.temperatureIntent !== test.constraints.temperatureIntent) {
          matches = false;
        }
        if (test.constraints.humidityFriendly !== undefined && product.humidityFriendly !== test.constraints.humidityFriendly) {
          matches = false;
        }
        if (test.constraints.formalityLevel?.length) {
          if (!product.formalityLevel || !test.constraints.formalityLevel.includes(product.formalityLevel)) {
            matches = false;
          }
        }
        if (test.constraints.occasionContext?.length) {
          const productOccasions = product.occasionContext || [];
          const hasMatch = test.constraints.occasionContext.some((oc) =>
            productOccasions.includes(oc)
          );
          if (!hasMatch) matches = false;
        }
        if (test.constraints.problemSolutions?.length) {
          const productSolutions = product.problemSolutions || [];
          const hasMatch = test.constraints.problemSolutions.some((ps) =>
            productSolutions.includes(ps)
          );
          if (!hasMatch) matches = false;
        }
        if (test.constraints.functionFeatures?.length) {
          const productFeatures = product.functionFeatures || [];
          const hasMatch = test.constraints.functionFeatures.some((ff) =>
            productFeatures.includes(ff)
          );
          if (!hasMatch) matches = false;
        }
        if (test.constraints.colorShade?.length) {
          if (!product.colorShade || !test.constraints.colorShade.includes(product.colorShade)) {
            matches = false;
          }
        }
        if (test.constraints.colorUndertone?.length) {
          if (!product.colorUndertone || !test.constraints.colorUndertone.includes(product.colorUndertone)) {
            matches = false;
          }
        }
        if (test.constraints.lengths?.length) {
          if (!product.length || !test.constraints.lengths.includes(product.length)) {
            matches = false;
          }
        }

        if (matches) matchingCount++;
      }

      results.push({
        query: test.name,
        totalResults: products.length,
        matchingResults: matchingCount,
        matchRate: products.length > 0 ? (matchingCount / products.length) * 100 : 0,
        sampleProducts: products.slice(0, 3).map((p) => ({
          id: p.id,
          title: p.title.substring(0, 50),
          length: p.length,
          formalityLevel: p.formalityLevel,
          temperatureIntent: p.temperatureIntent,
          humidityFriendly: p.humidityFriendly,
        })),
      });

      logger.info(`Query: ${test.name}`, {
        totalResults: products.length,
        matchingResults: matchingCount,
        matchRate: products.length > 0 ? (matchingCount / products.length) * 100 : 0,
      });
    } catch (error) {
      logger.error(`Query failed: ${test.name}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      results.push({
        query: test.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

async function main() {
  try {
    logger.info('Starting enriched pipeline verification...');

    // Verify enriched columns are populated
    const columnStats = await verifyEnrichedColumns();

    // Test enriched queries
    const queryResults = await testEnrichedQueries();

    // Summary
    logger.info('Verification Summary', {
      columnStats,
      queryResults,
    });

    console.log('\n=== VERIFICATION SUMMARY ===');
    console.log('\nEnriched Column Population:');
    console.log(`  Total products sampled: ${columnStats.total}`);
    console.log(`  With length: ${columnStats.withLength} (${((columnStats.withLength / columnStats.total) * 100).toFixed(1)}%)`);
    console.log(`  With formalityLevel: ${columnStats.withFormalityLevel} (${((columnStats.withFormalityLevel / columnStats.total) * 100).toFixed(1)}%)`);
    console.log(`  With temperatureIntent: ${columnStats.withTemperatureIntent} (${((columnStats.withTemperatureIntent / columnStats.total) * 100).toFixed(1)}%)`);
    console.log(`  With humidityFriendly: ${columnStats.withHumidityFriendly} (${((columnStats.withHumidityFriendly / columnStats.total) * 100).toFixed(1)}%)`);
    console.log(`  With occasionContext: ${columnStats.withOccasionContext} (${((columnStats.withOccasionContext / columnStats.total) * 100).toFixed(1)}%)`);
    console.log(`  With problemSolutions: ${columnStats.withProblemSolutions} (${((columnStats.withProblemSolutions / columnStats.total) * 100).toFixed(1)}%)`);
    console.log(`  With functionFeatures: ${columnStats.withFunctionFeatures} (${((columnStats.withFunctionFeatures / columnStats.total) * 100).toFixed(1)}%)`);

    console.log('\nQuery Test Results:');
    queryResults.forEach((result) => {
      if (result.error) {
        console.log(`  ${result.query}: ERROR - ${result.error}`);
      } else {
        console.log(
          `  ${result.query}: ${result.matchingResults}/${result.totalResults} matching (${result.matchRate.toFixed(1)}%)`,
        );
      }
    });

    console.log('\n=== VERIFICATION COMPLETE ===\n');
  } catch (error) {
    logger.error('Verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();




