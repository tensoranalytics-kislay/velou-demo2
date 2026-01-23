import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { logger } from './src/lib/telemetry/logger';

async function testOfficeWearDressesQuery() {
  console.log('='.repeat(80));
  console.log('Testing: "I am joining office next month, suggest me a dress to wear"');
  console.log('='.repeat(80));
  console.log();

  const query = "I am joining office next month, suggest me a dress to wear";
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  const startTime = Date.now();
  
  try {
    const result = await handleLoveshackfancyQuery({
      message: query,
      sessionId: 'test-session-office-wear-dresses',
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
      console.log('📦 Products Recommended:');
      result.productCards.forEach((p, i) => {
        console.log(`\n  ${i + 1}. ${p.title}`);
        console.log(`     Price: $${(p.priceCents / 100).toFixed(2)}`);
        console.log(`     Category: ${p.category || 'N/A'}`);
        console.log(`     URL: ${p.productUrl || 'N/A'}`);
        if ((p as any).occasionContext) {
          console.log(`     Occasions: ${JSON.stringify((p as any).occasionContext)}`);
        }
        if ((p as any).formalityLevel) {
          console.log(`     Formality: ${(p as any).formalityLevel}`);
        }
      });
      console.log();
    } else {
      console.log('❌ No products returned');
    }

    console.log('💬 Reply Preview:');
    console.log(result.replyText?.substring(0, 500) || 'No reply');
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

testOfficeWearDressesQuery();
