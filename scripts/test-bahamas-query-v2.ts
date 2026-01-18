import { handleLoveshackfancyQuery } from '../src/lib/loveshackfancy/orchestrator';

async function main() {
  const query = "I am going to Bahamas for vacation, suggest me a dress.";
  const merchantId = process.env.MERCHANT_ID || 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  console.log('🧪 Testing Query:\n');
  console.log(`   "${query}"\n`);

  try {
    const result = await handleLoveshackfancyQuery({
      message: query,
      merchantId,
      sessionId: 'test-bahamas-query-' + Date.now(),
    });

    console.log('📊 Results:\n');
    console.log(`   Reply Text Length: ${result.replyText?.length || 0} characters`);
    console.log(`   Top Categories: ${result.topCategories?.join(', ') || 'none'}`);
    
    // Check both result.products and result.items
    const products = (result as any).products || (result as any).items || [];
    console.log(`   Products Array Length: ${products.length}`);
    
    if (products && products.length > 0) {
      console.log(`\n✅ Success! Found ${products.length} products:\n`);
      products.slice(0, 4).forEach((p: any, i: number) => {
        console.log(`   ${i + 1}. ${p.title || p.productTitle || 'Unknown'}`);
        console.log(`      Category: ${p.category || 'unknown'}`);
        if (p.subcategory) console.log(`      Subcategory: ${p.subcategory}`);
      });
      console.log(`\n📝 Reply Preview:\n   ${(result.replyText || '').substring(0, 200)}...\n`);
    } else {
      console.log(`\n⚠️  Products array is empty`);
      console.log(`   Result keys: ${Object.keys(result).join(', ')}`);
    }

    console.log('\n✅ Test complete!\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error:', error.message);
      console.error('   Stack:', error.stack?.substring(0, 500));
    }
    process.exit(1);
  }
}

main().catch(console.error);
