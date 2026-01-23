import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { logger } from './src/lib/telemetry/logger';

async function testWomensLongSleeveTshirts() {
  console.log('='.repeat(80));
  console.log('Testing: "I am looking for women\'s long sleeve tshirt"');
  console.log('='.repeat(80));
  console.log();

  const query = "I am looking for women's long sleeve tshirt";
  
  // Use the actual merchant ID from database (slug='default')
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  const startTime = Date.now();
  
  try {
    const result = await handleLoveshackfancyQuery({
      message: query,
      sessionId: 'test-session-womens-long-sleeve-tshirts',
      merchantId: merchantId,
    });

    const totalDuration = Date.now() - startTime;

    console.log('✅ Query completed successfully\n');
    console.log(`⏱️  Total time: ${(totalDuration / 1000).toFixed(2)}s\n`);
    
    console.log('📊 Results Summary:');
    console.log(`  Products returned: ${result.productCards?.length || 0}`);
    console.log(`  Has reply: ${!!result.replyText}`);
    console.log(`  No exact match: ${result.noExactMatch}`);
    console.log();

    if (result.productCards && result.productCards.length > 0) {
      console.log('📦 Products Returned:');
      result.productCards.forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.title}`);
        console.log(`     Price: $${(p.priceCents / 100).toFixed(2)}`);
        console.log(`     Category: ${p.category || 'N/A'}`);
        console.log();
      });
    } else {
      console.log('❌ No products returned');
    }

    console.log('💬 Reply Preview:');
    console.log(result.replyText?.substring(0, 300) || 'No reply');
    console.log();

  } catch (error) {
    console.error('❌ Error:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  } finally {
    process.exit(0);
  }
}

testWomensLongSleeveTshirts();
