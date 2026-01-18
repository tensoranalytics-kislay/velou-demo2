import { handleLoveshackfancyQuery } from '../src/lib/loveshackfancy/orchestrator';

async function main() {
  const query = "I am going to Bahamas for vacation, suggest me a dress.";
  const merchantId = process.env.MERCHANT_ID || 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  console.log('🧪 Testing Query:\n');
  console.log(`   "${query}"\n`);
  console.log('='.repeat(80));
  console.log();

  try {
    const result = await handleLoveshackfancyQuery({
      message: query,
      merchantId,
      sessionId: 'test-bahamas-query-' + Date.now(),
    });

    console.log('\n📊 Results:\n');
    console.log(`   Reply Text Length: ${result.replyText?.length || 0} characters`);
    console.log(`   Products Returned: ${result.products?.length || 0}`);
    console.log(`   Categories Classified: ${result.topCategories?.length || 0}`);
    if (result.topCategories && result.topCategories.length > 0) {
      console.log(`   Categories: ${result.topCategories.join(', ')}`);
    }
    
    if (result.products && result.products.length > 0) {
      console.log(`\n📦 Sample Products (first 4):\n`);
      result.products.slice(0, 4).forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.title}`);
        console.log(`      Category: ${p.category}${p.subcategory ? ` > ${p.subcategory}` : ''}`);
        console.log(`      Gender: ${p.gender || 'null'}`);
        console.log(`      Price: $${((p.priceCents || 0) / 100).toFixed(2)}`);
        console.log();
      });
    } else {
      console.log('\n⚠️  No products returned!\n');
    }

    console.log('='.repeat(80));
    console.log('\n✅ Test complete!\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error:', error.message);
    }
    process.exit(1);
  }
}

main().catch(console.error);
