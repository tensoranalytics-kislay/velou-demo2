import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';
import { logger } from './src/lib/telemetry/logger';
import { getState } from './src/lib/chat/ConversationStateService';

// Capture enhanced queries from logs
const enhancedQueries: string[] = [];
const originalLogInfo = logger.info.bind(logger);
logger.info = (...args: any[]) => {
  if (args[0] === 'constraint_merger_result' && args[1]?.enhancedQueryText) {
    enhancedQueries.push(args[1].enhancedQueryText);
  }
  return originalLogInfo(...args);
};

async function testConstraintMergerFollowUps() {
  console.log('='.repeat(80));
  console.log('TESTING: Constraint Merger with Multiple Follow-Ups');
  console.log('='.repeat(80));

  // Test scenarios with different constraint types
  const testScenarios = [
    {
      name: 'Test 1: Color, Material, Pattern, Size, Price',
      queries: [
        'show me dresses',
        'in blue', // MERGE: add color
        'also in silk', // MERGE: add material
        'with floral patterns', // MERGE: add pattern
        'size 4', // MERGE: add size
        'under $200', // MERGE: add price
      ],
    },
    {
      name: 'Test 2: Replace Operations',
      queries: [
        'red dresses',
        'change to navy', // REPLACE: color
        'cotton instead', // REPLACE: material
        'mini instead', // REPLACE: length
        'size 6 instead', // REPLACE: size
      ],
    },
    {
      name: 'Test 3: Remove Operations',
      queries: [
        'red silk maxi dresses under $200',
        'any color is fine', // REMOVE: color
        'any material', // REMOVE: material
        'price doesn\'t matter', // REMOVE: price
      ],
    },
    {
      name: 'Test 4: Exclude Operations',
      queries: [
        'dresses',
        'not blue', // EXCLUDE: color
        'avoid cotton', // EXCLUDE: material
        'without floral', // EXCLUDE: pattern
      ],
    },
    {
      name: 'Test 5: Mixed Operations with Less Common Constraints',
      queries: [
        'show me tops',
        'also high rise', // MERGE: add rise
        'also plus size', // MERGE: add inclusivitySizing
        'with pockets', // MERGE: add pockets
        'any rise is fine', // REMOVE: rise
      ],
    },
    {
      name: 'Test 6: Complex Multi-Attribute Follow-Ups',
      queries: [
        'dresses for wedding',
        'in light colours', // MERGE: add colors (expanded)
        'floral ones', // MERGE: add pattern
        'maxi length', // MERGE: add length
        'long sleeves', // MERGE: add sleeveLength
        'v-neck', // MERGE: add neckline
      ],
    },
  ];

  for (const scenario of testScenarios) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SCENARIO: ${scenario.name}`);
    console.log('='.repeat(80));

    const sessionId = `test-merger-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    let previousResult: any = null;

    // Clear enhanced queries for this scenario
    enhancedQueries.length = 0;

    for (let i = 0; i < scenario.queries.length; i++) {
      const query = scenario.queries[i];
      const isFirst = i === 0;

      console.log(`\n${'-'.repeat(80)}`);
      console.log(`Follow-Up ${i + 1}/${scenario.queries.length}: "${query}"`);
      console.log(`${'-'.repeat(80)}`);

      try {
        // CRITICAL: Read the latest state from the database to ensure we have the most recent enhanced query
        // This ensures we're using the actual enhanced query that was stored by the previous query
        const currentState = await getState(
          'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
          sessionId
        );

        const result = await handleAssistantQuery(
          'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
          {
            message: query,
            sessionId,
            // conversationState removed - not part of AssistantQueryInput API
            conversationContext: previousResult
              ? {
                  lastEnhancedQuery: previousResult.enhancedQuery || previousResult.query || null, // CRITICAL: Pass enhanced query directly from previous result
                  lastConstraints: previousResult.resolvedConstraints || null,
                  lastClassificationConstraints: previousResult.resolvedClassificationConstraints || null,
                }
              : undefined,
          }
        );

        // Get enhanced query from logs (captured by logger hook)
        const enhancedQuery = enhancedQueries[enhancedQueries.length - 1] || query;

        console.log(`\n📝 Enhanced Query: "${enhancedQuery}"`);
        console.log(`\n📦 Products Returned: ${result.productCards?.length || 0}`);

        // Show key resolved constraints (simplified)
        if (result.resolvedConstraints) {
          const constraints = result.resolvedConstraints;
          const keyConstraints: string[] = [];
          
          if (constraints.colors && Array.isArray(constraints.colors) && constraints.colors.length > 0) {
            keyConstraints.push(`colors: [${constraints.colors.slice(0, 3).join(', ')}${constraints.colors.length > 3 ? '...' : ''}]`);
          }
          if (constraints.materials && Array.isArray(constraints.materials) && constraints.materials.length > 0) {
            keyConstraints.push(`materials: [${constraints.materials.join(', ')}]`);
          }
          if (constraints.patterns && Array.isArray(constraints.patterns) && constraints.patterns.length > 0) {
            keyConstraints.push(`patterns: [${constraints.patterns.join(', ')}]`);
          }
          if (constraints.sizes && Array.isArray(constraints.sizes) && constraints.sizes.length > 0) {
            keyConstraints.push(`sizes: [${constraints.sizes.join(', ')}]`);
          }
          if (constraints.priceMaxCents) {
            keyConstraints.push(`priceMax: $${constraints.priceMaxCents / 100}`);
          }
          if (constraints.priceMinCents) {
            keyConstraints.push(`priceMin: $${constraints.priceMinCents / 100}`);
          }
          if (constraints.lengths && Array.isArray(constraints.lengths) && constraints.lengths.length > 0) {
            keyConstraints.push(`lengths: [${constraints.lengths.join(', ')}]`);
          }
          if (constraints.sleeveLengths && Array.isArray(constraints.sleeveLengths) && constraints.sleeveLengths.length > 0) {
            keyConstraints.push(`sleeveLengths: [${constraints.sleeveLengths.join(', ')}]`);
          }
          if (constraints.necklines && Array.isArray(constraints.necklines) && constraints.necklines.length > 0) {
            keyConstraints.push(`necklines: [${constraints.necklines.join(', ')}]`);
          }
          if (constraints.rises && Array.isArray(constraints.rises) && constraints.rises.length > 0) {
            keyConstraints.push(`rises: [${constraints.rises.join(', ')}]`);
          }
          if (constraints.inclusivitySizing && Array.isArray(constraints.inclusivitySizing) && constraints.inclusivitySizing.length > 0) {
            keyConstraints.push(`inclusivitySizing: [${constraints.inclusivitySizing.join(', ')}]`);
          }

          if (keyConstraints.length > 0) {
            console.log(`\n🔍 Key Constraints: ${keyConstraints.join(', ')}`);
          }
        }

        // Store for next iteration - use enhancedQuery from result if available, otherwise from logs
        const finalEnhancedQuery = result.enhancedQuery || enhancedQuery || query;
        previousResult = {
          ...result,
          enhancedQuery: finalEnhancedQuery,
          query: finalEnhancedQuery,
          categories: result.resolvedConstraints?.category ? 
            (Array.isArray(result.resolvedConstraints.category) ? result.resolvedConstraints.category : [result.resolvedConstraints.category]) 
            : undefined,
        };

        // CRITICAL: Wait a bit longer to ensure updateMemory completes and state is persisted
        // This ensures the next query reads the correct enhanced query from the database
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`\n❌ Error processing query ${i + 1}:`, error);
        if (error instanceof Error) {
          console.error(`   Message: ${error.message}`);
        }
        break;
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Completed: ${scenario.name}`);
    console.log('='.repeat(80));
  }

  await prisma.$disconnect();
}

// Run the test
testConstraintMergerFollowUps()
  .then(() => {
    console.log('\n✅ All tests completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
