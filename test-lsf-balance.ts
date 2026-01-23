import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';

async function testLSFBalance() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  const queries = [
    'I want a blue dress',
    'I am looking for a floral dress',
    'show me white dresses',
    'suggest me a casual dress',
  ];

  console.log('Testing LSF Brand Boost Balance\n');
  console.log('='.repeat(80));

  const results: Array<{ query: string; total: number; lsf: number; brands: string[] }> = [];

  for (const query of queries) {
    try {
      const result = await handleLoveshackfancyQuery({
        message: query,
        sessionId: `test-balance-${Date.now()}`,
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
      });

      console.log(`\nQuery: "${query}"`);
      console.log(`  Products: ${products.length} total, ${lsfProducts.length} LSF (${((lsfProducts.length / products.length) * 100).toFixed(0)}%)`);
      console.log(`  Brands: ${brands.join(', ')}`);

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error with query "${query}":`, error);
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
  console.log(`\nTarget: 50-70% LSF products (balanced, not dominating)`);
  
  if (avgLSFPercentage >= 50 && avgLSFPercentage <= 70) {
    console.log('✅ GOOD: LSF products are well-balanced');
  } else if (avgLSFPercentage > 70) {
    console.log('⚠️  WARNING: LSF products are dominating (reduce boost)');
  } else {
    console.log('⚠️  WARNING: LSF products are too low (increase boost)');
  }

  process.exit(0);
}

testLSFBalance().catch(console.error);
