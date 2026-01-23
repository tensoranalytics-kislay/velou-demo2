import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { logger } from './src/lib/telemetry/logger';

async function testSetVsSingleFiltering() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  const testQueries = [
    {
      name: 'Normal Query (Should show Single products only)',
      query: 'I want a blue dress',
      expectedSetVsSingle: 'Single',
    },
    {
      name: 'Pack Query - Explicit Pack Mention',
      query: 'I want a 3-pack of t-shirts',
      expectedSetVsSingle: 'Set',
    },
    {
      name: 'Pack Query - Bundle Mention',
      query: 'show me t-shirt bundles',
      expectedSetVsSingle: 'Set',
    },
    {
      name: 'Normal Query - No Pack Mention',
      query: 'I am looking for women\'s jeans',
      expectedSetVsSingle: 'Single',
    },
    {
      name: 'Pack Query - Multi-pack Mention',
      query: 'I need a 4-pack of underwear',
      expectedSetVsSingle: 'Set',
    },
    {
      name: 'Normal Query - Casual Wear',
      query: 'suggest me something casual to wear',
      expectedSetVsSingle: 'Single',
    },
  ];

  console.log('='.repeat(80));
  console.log('Testing setVsSingle Filtering Implementation');
  console.log('='.repeat(80));
  console.log();

  const results: Array<{
    name: string;
    query: string;
    expectedSetVsSingle: string;
    actualSetVsSingle?: string;
    productsReturned: number;
    productTitles: string[];
    setVsSingleExtracted?: boolean;
  }> = [];

  for (let i = 0; i < testQueries.length; i++) {
    const test = testQueries[i];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Test ${i + 1}/${testQueries.length}: ${test.name}`);
    console.log(`Query: "${test.query}"`);
    console.log(`Expected: ${test.expectedSetVsSingle} products`);
    console.log('='.repeat(80));
    console.log();

    const startTime = Date.now();

    try {
      const result = await handleLoveshackfancyQuery({
        message: test.query,
        sessionId: `test-set-vs-single-${i}`,
        merchantId: merchantId,
      });

      const duration = Date.now() - startTime;

      // Extract setVsSingle from logs (we'll need to check the actual filter applied)
      // For now, we'll infer from product results
      const productTitles = result.productCards?.map(p => p.title) || [];
      
      // Check if any products are packs (have "pack" in title)
      const hasPackProducts = productTitles.some(title => 
        /pack|bundle|set|multi/i.test(title) && !/single|individual/i.test(title)
      );
      
      const actualSetVsSingle = hasPackProducts ? 'Set' : 'Single';

      console.log(`✅ Query completed in ${(duration / 1000).toFixed(2)}s`);
      console.log(`📊 Products returned: ${result.productCards?.length || 0}`);
      console.log(`🔍 Filter applied: ${actualSetVsSingle} (inferred from results)`);
      console.log();

      if (result.productCards && result.productCards.length > 0) {
        console.log('📦 Products Returned:');
        result.productCards.slice(0, 10).forEach((p, idx) => {
          const isPack = /pack|bundle|set|multi/i.test(p.title) && !/single|individual/i.test(p.title);
          const packIndicator = isPack ? ' [PACK]' : ' [SINGLE]';
          console.log(`  ${idx + 1}. ${p.title}${packIndicator}`);
          console.log(`     Price: $${(p.priceCents / 100).toFixed(2)}`);
        });
        if (result.productCards.length > 10) {
          console.log(`  ... and ${result.productCards.length - 10} more products`);
        }
      } else {
        console.log('❌ No products returned');
      }

      results.push({
        name: test.name,
        query: test.query,
        expectedSetVsSingle: test.expectedSetVsSingle,
        actualSetVsSingle,
        productsReturned: result.productCards?.length || 0,
        productTitles: productTitles.slice(0, 10),
        setVsSingleExtracted: actualSetVsSingle === test.expectedSetVsSingle,
      });

      // Small delay between queries
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`❌ Error:`, error);
      results.push({
        name: test.name,
        query: test.query,
        expectedSetVsSingle: test.expectedSetVsSingle,
        productsReturned: 0,
        productTitles: [],
        setVsSingleExtracted: false,
      });
    }
  }

  // Summary
  console.log('\n\n');
  console.log('='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log();

  results.forEach((result, idx) => {
    const status = result.setVsSingleExtracted ? '✅' : '❌';
    console.log(`${status} Test ${idx + 1}: ${result.name}`);
    console.log(`   Query: "${result.query}"`);
    console.log(`   Expected: ${result.expectedSetVsSingle}, Got: ${result.actualSetVsSingle || 'N/A'}`);
    console.log(`   Products: ${result.productsReturned}`);
    if (result.productTitles.length > 0) {
      console.log(`   Sample products: ${result.productTitles.slice(0, 3).join(', ')}`);
    }
    console.log();
  });

  const passed = results.filter(r => r.setVsSingleExtracted).length;
  const total = results.length;
  console.log(`\n✅ Passed: ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)`);

  process.exit(0);
}

testSetVsSingleFiltering().catch(console.error);
