import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';

async function testDressQueryWithBrandBoost() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  console.log('Testing: "I want a blue dress"');
  console.log('='.repeat(80));
  console.log();
  
  const result = await handleLoveshackfancyQuery({
    message: 'I want a blue dress',
    sessionId: 'test-dress-query-brand-boost',
    merchantId: merchantId,
  });
  
  console.log(`Products returned: ${result.productCards?.length || 0}`);
  console.log();
  
  if (result.productCards && result.productCards.length > 0) {
    console.log('Products Returned:');
    result.productCards.forEach((p, i) => {
      const brand = (p as any).brand || 'Unknown';
      const isLSF = brand.toLowerCase().includes('loveshackfancy') || brand.toLowerCase() === 'lsf';
      const indicator = isLSF ? ' [LOVESHACKFANCY]' : '';
      console.log(`  ${i + 1}. ${p.title}${indicator}`);
      console.log(`     Brand: ${brand}`);
      console.log(`     Price: $${(p.priceCents / 100).toFixed(2)}`);
      console.log();
    });
    
    const lsfCount = result.productCards.filter(p => {
      const brand = (p as any).brand || '';
      return brand.toLowerCase().includes('loveshackfancy') || brand.toLowerCase() === 'lsf';
    }).length;
    
    console.log(`LoveShackFancy products in results: ${lsfCount}/${result.productCards.length}`);
  }
  
  process.exit(0);
}

testDressQueryWithBrandBoost().catch(console.error);
