import { handleLoveshackfancyQuery } from '../src/lib/loveshackfancy/orchestrator';

async function main() {
  const query = "I am going to Bahamas for vacation, suggest me a dress.";
  const merchantId = process.env.MERCHANT_ID || 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  console.log('⏱️  Timing Test\n');
  console.log(`   Query: "${query}"\n`);
  console.log('='.repeat(80));
  
  const startTime = Date.now();
  
  try {
    const result = await handleLoveshackfancyQuery({
      message: query,
      merchantId,
      sessionId: 'test-timing-' + Date.now(),
    });

    const endTime = Date.now();
    const totalDuration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log(`\n✅ Query completed in ${totalDuration} seconds\n`);
    console.log(`   Total Duration: ${totalDuration}s`);
    console.log(`   Products Returned: ${(result as any).productCards?.length || 0}`);
    console.log(`   Reply Text: ${result.replyText?.length || 0} characters\n`);
    
  } catch (error) {
    const endTime = Date.now();
    const totalDuration = ((endTime - startTime) / 1000).toFixed(2);
    console.error(`\n❌ Query failed after ${totalDuration} seconds`);
    console.error('   Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch(console.error);
