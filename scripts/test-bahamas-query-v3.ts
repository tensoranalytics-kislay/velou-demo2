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
    
    // Check productCards
    const productCards = (result as any).productCards || [];
    console.log(`   Product Cards: ${productCards.length}`);
    
    if (productCards && productCards.length > 0) {
      console.log(`\n✅ Success! Found ${productCards.length} products:\n`);
      productCards.slice(0, 4).forEach((p: any, i: number) => {
        console.log(`   ${i + 1}. ${p.title || p.productTitle || 'Unknown'}`);
        console.log(`      Category: ${p.category || 'unknown'}`);
        if (p.subcategory) console.log(`      Subcategory: ${p.subcategory}`);
        if (p.priceCents) console.log(`      Price: $${(p.priceCents / 100).toFixed(2)}`);
      });
      console.log(`\n📝 Reply Preview:\n   ${(result.replyText || '').substring(0, 300)}...\n`);
    } else {
      console.log(`\n⚠️  Product cards array is empty`);
    }

    // Check resolved categories
    const topCategories = (result as any).topCategories || result.resolvedConstraints?.categories;
    if (topCategories) {
      console.log(`\n✅ Categories Classified: ${topCategories.join(', ')}\n`);
    }

    console.log('✅ Test complete!\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error:', error.message);
    }
    process.exit(1);
  }
}

main().catch(console.error);
