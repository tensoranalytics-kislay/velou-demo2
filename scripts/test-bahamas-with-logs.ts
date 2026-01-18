/**
 * Test Bahamas query with detailed logging
 * Query: "I am going to Bahamas for vacation, suggest me a dress."
 */

import { handleLoveshackfancyQuery } from '../src/lib/loveshackfancy/orchestrator';
import { logger } from '../src/lib/telemetry/logger';

async function main() {
  const query = "I am going to Bahamas for vacation, suggest me a dress.";
  const merchantId = process.env.MERCHANT_ID || 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  console.log('🧪 Testing Bahamas Query with Detailed Logging\n');
  console.log(`   Query: "${query}"`);
  console.log(`   Merchant ID: ${merchantId}\n`);
  console.log('='.repeat(80));
  console.log();

  const startTime = Date.now();

  try {
    const result = await handleLoveshackfancyQuery({
      message: query,
      merchantId,
      sessionId: 'test-bahamas-logs-' + Date.now(),
    });

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(80));
    console.log('✅ PIPELINE EXECUTION COMPLETE');
    console.log('='.repeat(80));
    console.log(`\n⏱️  Total Duration: ${duration}s`);
    console.log(`   Products Returned: ${(result as any).productCards?.length || 0}`);
    console.log(`   Reply Length: ${result.replyText?.length || 0} chars`);
    
    // Check categories
    if (result.topCategories && result.topCategories.length > 0) {
      console.log(`   Categories: ${result.topCategories.join(', ')}`);
    }
    
    // Check constraints from classification
    const classification = (result as any).classification;
    if (classification && classification.constraints) {
      console.log('\n📋 Extracted Constraints:\n');
      const constraints = classification.constraints;
      Object.keys(constraints).forEach(key => {
        const value = constraints[key];
        if (value && Array.isArray(value) && value.length > 0) {
          console.log(`   ${key}: ${JSON.stringify(value)}`);
        } else if (value && !Array.isArray(value)) {
          console.log(`   ${key}: ${JSON.stringify(value)}`);
        }
      });
    }
    
    // Show sample products
    const productCards = (result as any).productCards || [];
    if (productCards.length > 0) {
      console.log(`\n📦 Products Returned (${productCards.length}):\n`);
      productCards.slice(0, 4).forEach((card: any, i: number) => {
        console.log(`   ${i + 1}. ${card.title?.substring(0, 70)}...`);
        console.log(`      ID: ${card.id}`);
        console.log(`      Category: ${card.category || 'unknown'}`);
        if (card.price) console.log(`      Price: ${card.price}`);
        console.log();
      });
    }

    console.log('\n📝 Reply Preview:');
    console.log(`   ${(result.replyText || '').substring(0, 300)}...\n`);

    console.log('='.repeat(80));
    console.log('\n📋 Check console logs above for detailed pipeline execution');
    console.log('   Look for:');
    console.log('   - category_classification_complete_with_confidence_sequential');
    console.log('   - constraint_classification_calling_sequential_after_categories');
    console.log('   - Category-specific dictionary usage');
    console.log('   - Constraint extraction details');
    console.log('   - Product loading information');
    console.log('='.repeat(80));

  } catch (error) {
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.error(`\n❌ Query failed after ${duration} seconds`);
    console.error('   Error:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('   Stack:', error.stack.substring(0, 500));
    }
    process.exit(1);
  }
}

main().catch(console.error);
