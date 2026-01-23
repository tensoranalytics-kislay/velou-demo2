import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { logger } from './src/lib/telemetry/logger';

async function testLSFBrandBoostFullPipeline() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  const testQueries = [
    {
      name: 'Blue Dress Query',
      query: 'I want a blue dress',
      expectedLSF: true,
    },
    {
      name: 'Floral Dress Query',
      query: 'I am looking for a floral dress',
      expectedLSF: true,
    },
    {
      name: 'White Dress Query',
      query: 'show me white dresses',
      expectedLSF: true,
    },
    {
      name: 'Casual Dress Query',
      query: 'suggest me a casual dress',
      expectedLSF: true,
    },
  ];

  console.log('='.repeat(80));
  console.log('LoveShackFancy Brand Boost - Full Pipeline Test');
  console.log('='.repeat(80));
  console.log();

  const results: Array<{
    name: string;
    query: string;
    totalProducts: number;
    lsfProducts: number;
    lsfProductTitles: string[];
    allProductTitles: string[];
    allBrands: string[];
    hasLSF: boolean;
  }> = [];

  for (let i = 0; i < testQueries.length; i++) {
    const test = testQueries[i];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Test ${i + 1}/${testQueries.length}: ${test.name}`);
    console.log(`Query: "${test.query}"`);
    console.log('='.repeat(80));
    console.log();

    const startTime = Date.now();

    try {
      const result = await handleLoveshackfancyQuery({
        message: test.query,
        sessionId: `test-lsf-boost-${i}`,
        merchantId: merchantId,
      });

      const duration = Date.now() - startTime;

      const productCards = result.productCards || [];
      const lsfProducts = productCards.filter(p => {
        const brand = ((p as any).brand || '').toLowerCase();
        const title = (p.title || '').toLowerCase();
        return brand.includes('loveshackfancy') || 
               brand === 'lsf' || 
               title.includes('loveshackfancy');
      });

      const allBrands = productCards.map(p => {
        const brand = (p as any).brand || 'Unknown';
        return brand;
      });

      console.log(`✅ Query completed in ${(duration / 1000).toFixed(2)}s`);
      console.log(`📊 Total products returned: ${productCards.length}`);
      console.log(`🎯 LoveShackFancy products: ${lsfProducts.length}/${productCards.length}`);
      console.log();

      if (productCards.length > 0) {
        console.log('📦 Products Returned:');
        productCards.forEach((p, idx) => {
          const brand = (p as any).brand || 'Unknown';
          const isLSF = lsfProducts.includes(p);
          const indicator = isLSF ? ' [LOVESHACKFANCY ⭐]' : '';
          console.log(`  ${idx + 1}. ${p.title}${indicator}`);
          console.log(`     Brand: ${brand}`);
          console.log(`     Price: $${(p.priceCents / 100).toFixed(2)}`);
          if (p.reason) {
            console.log(`     Reason: ${p.reason.substring(0, 80)}...`);
          }
          console.log();
        });
      } else {
        console.log('❌ No products returned');
      }

      results.push({
        name: test.name,
        query: test.query,
        totalProducts: productCards.length,
        lsfProducts: lsfProducts.length,
        lsfProductTitles: lsfProducts.map(p => p.title),
        allProductTitles: productCards.map(p => p.title),
        allBrands: allBrands,
        hasLSF: lsfProducts.length > 0,
      });

      // Small delay between queries
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error(`❌ Error:`, error);
      results.push({
        name: test.name,
        query: test.query,
        totalProducts: 0,
        lsfProducts: 0,
        lsfProductTitles: [],
        allProductTitles: [],
        allBrands: [],
        hasLSF: false,
      });
    }
  }

  // Summary
  console.log('\n\n');
  console.log('='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log();

  let totalLSFCount = 0;
  let totalProductsCount = 0;

  results.forEach((result, idx) => {
    const status = result.hasLSF ? '✅' : '❌';
    const lsfPercentage = result.totalProducts > 0 
      ? ((result.lsfProducts / result.totalProducts) * 100).toFixed(1)
      : '0.0';
    
    console.log(`${status} Test ${idx + 1}: ${result.name}`);
    console.log(`   Query: "${result.query}"`);
    console.log(`   Total Products: ${result.totalProducts}`);
    console.log(`   LSF Products: ${result.lsfProducts} (${lsfPercentage}%)`);
    console.log(`   Brands: ${[...new Set(result.allBrands)].join(', ')}`);
    if (result.lsfProductTitles.length > 0) {
      console.log(`   LSF Products Found:`);
      result.lsfProductTitles.forEach(title => {
        console.log(`     - ${title}`);
      });
    }
    console.log();

    totalLSFCount += result.lsfProducts;
    totalProductsCount += result.totalProducts;
  });

  const overallLSFPercentage = totalProductsCount > 0 
    ? ((totalLSFCount / totalProductsCount) * 100).toFixed(1)
    : '0.0';

  console.log('='.repeat(80));
  console.log('OVERALL STATISTICS');
  console.log('='.repeat(80));
  console.log(`Total Products Returned: ${totalProductsCount}`);
  console.log(`Total LSF Products: ${totalLSFCount}`);
  console.log(`LSF Percentage: ${overallLSFPercentage}%`);
  console.log(`Tests with LSF Products: ${results.filter(r => r.hasLSF).length}/${results.length}`);
  console.log();

  const allTestsPassed = results.every(r => r.hasLSF);
  if (allTestsPassed) {
    console.log('✅ SUCCESS: All tests show LoveShackFancy products appearing in results!');
  } else {
    console.log('⚠️  WARNING: Some tests did not return LoveShackFancy products.');
    console.log('   This may indicate the brand boost needs adjustment or products are being filtered out.');
  }

  process.exit(0);
}

testLSFBrandBoostFullPipeline().catch(console.error);
