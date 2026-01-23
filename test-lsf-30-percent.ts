import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';

async function testLSF30Percent() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  // 10 diverse prompts that might target LSF products
  const queries = [
    'I want a blue dress',
    'I am looking for a floral dress',
    'show me white dresses',
    'suggest me a casual dress',
    'I need a maxi dress for summer',
    'show me pink dresses',
    'I want a romantic dress',
    'looking for a chiffon dress',
    'I need a dress for a wedding',
    'show me elegant dresses',
  ];

  console.log('Testing LSF Brand Boost - Target: ~30% LSF Products\n');
  console.log('='.repeat(80));

  const results: Array<{ query: string; total: number; lsf: number; brands: string[]; lsfProducts: string[] }> = [];

  for (const query of queries) {
    try {
      const result = await handleLoveshackfancyQuery({
        message: query,
        sessionId: `test-30pct-${Date.now()}`,
        merchantId: merchantId,
      });

      const products = result.productCards || [];
      const lsfProducts = products.filter(p => {
        const brand = ((p as any).brand || '').toLowerCase();
        return brand.includes('loveshackfancy') || brand === 'lsf';
      });

      const brands = [...new Set(products.map(p => (p as any).brand || 'Unknown'))];

      results.push({
        query,
        total: products.length,
        lsf: lsfProducts.length,
        brands,
        lsfProducts: lsfProducts.map(p => p.title.substring(0, 60)),
      });

      const lsfPct = products.length > 0 ? ((lsfProducts.length / products.length) * 100).toFixed(1) : '0.0';
      console.log(`\nQuery: "${query}"`);
      console.log(`  Products: ${products.length} total, ${lsfProducts.length} LSF (${lsfPct}%)`);
      console.log(`  Brands: ${brands.join(', ')}`);
      if (lsfProducts.length > 0) {
        console.log(`  LSF Products:`);
        lsfProducts.forEach((p, i) => {
          console.log(`    ${i + 1}. ${p.title.substring(0, 70)}`);
        });
      }

      // Small delay between queries
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Error with query "${query}":`, error);
      results.push({
        query,
        total: 0,
        lsf: 0,
        brands: [],
        lsfProducts: [],
      });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  
  const totalProducts = results.reduce((sum, r) => sum + r.total, 0);
  const totalLSF = results.reduce((sum, r) => sum + r.lsf, 0);
  const avgLSFPercentage = totalProducts > 0 ? (totalLSF / totalProducts) * 100 : 0;

  console.log(`Total Products: ${totalProducts}`);
  console.log(`Total LSF Products: ${totalLSF}`);
  console.log(`Average LSF Percentage: ${avgLSFPercentage.toFixed(1)}%`);
  console.log(`\nTarget: ~30% LSF products on average`);
  
  if (avgLSFPercentage >= 25 && avgLSFPercentage <= 35) {
    console.log('✅ GOOD: LSF products are well-balanced around target');
  } else if (avgLSFPercentage > 35) {
    console.log(`⚠️  WARNING: LSF products are too high (${avgLSFPercentage.toFixed(1)}% > 35%). Reduce boost further.`);
  } else {
    console.log(`⚠️  WARNING: LSF products are too low (${avgLSFPercentage.toFixed(1)}% < 25%). Increase boost slightly.`);
  }

  console.log('\nPer-Query Breakdown:');
  results.forEach((r, idx) => {
    const pct = r.total > 0 ? ((r.lsf / r.total) * 100).toFixed(1) : '0.0';
    console.log(`  ${idx + 1}. "${r.query}": ${r.lsf}/${r.total} LSF (${pct}%)`);
  });

  process.exit(0);
}

testLSF30Percent().catch(console.error);
