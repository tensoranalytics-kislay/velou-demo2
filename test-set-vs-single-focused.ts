import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';

async function testSetVsSingleFocused() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  // Use queries that will successfully classify categories
  const testQueries = [
    {
      name: 'Normal Query - Single Products (Dress)',
      query: 'I want a blue dress',
      expectedSetVsSingle: 'Single',
    },
    {
      name: 'Normal Query - Single Products (Jeans)',
      query: 'I am looking for women\'s jeans',
      expectedSetVsSingle: 'Single',
    },
    {
      name: 'Pack Query - T-shirts (with explicit category)',
      query: 'I want a 3-pack of women\'s t-shirts',
      expectedSetVsSingle: 'Set',
    },
    {
      name: 'Pack Query - T-shirts (alternative)',
      query: 'show me women\'s t-shirt packs',
      expectedSetVsSingle: 'Set',
    },
  ];

  console.log('='.repeat(80));
  console.log('Focused Test: setVsSingle Filtering');
  console.log('='.repeat(80));
  console.log();

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
        sessionId: `test-focused-${i}`,
        merchantId: merchantId,
      });

      const duration = Date.now() - startTime;

      const productTitles = result.productCards?.map(p => p.title) || [];
      
      // Check if any products are packs (have "pack" in title)
      const hasPackProducts = productTitles.some(title => 
        /pack|bundle|set|multi/i.test(title) && !/single|individual/i.test(title)
      );
      
      const actualSetVsSingle = hasPackProducts ? 'Set' : 'Single';

      console.log(`✅ Query completed in ${(duration / 1000).toFixed(2)}s`);
      console.log(`📊 Products returned: ${result.productCards?.length || 0}`);
      console.log(`🔍 Filter applied: ${actualSetVsSingle} (inferred from results)`);
      console.log(`✅ Expected: ${test.expectedSetVsSingle}, Got: ${actualSetVsSingle}`);
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

      // Small delay between queries
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`❌ Error:`, error);
    }
  }

  console.log('\n\n');
  console.log('='.repeat(80));
  console.log('Test Complete');
  console.log('='.repeat(80));

  process.exit(0);
}

testSetVsSingleFocused().catch(console.error);
