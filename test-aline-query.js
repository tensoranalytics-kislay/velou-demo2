#!/usr/bin/env node

/**
 * Test script to query the assistant with "do you have any aline dresses?"
 * and analyze the logs for constraint extraction and search behavior
 */

// Using built-in fetch (Node.js 18+)

async function testAlineQuery() {
  const url = 'http://localhost:3000/api/assistant';
  
  const requestBody = {
    sessionId: `test-${Date.now()}`,
    pageType: 'HOME',
    message: 'do you have any aline dresses?',
    history: [],
  };

  console.log('='.repeat(80));
  console.log('TESTING: "do you have any aline dresses?"');
  console.log('='.repeat(80));
  console.log('\nRequest:', JSON.stringify(requestBody, null, 2));
  console.log('\nSending request...\n');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error('Response is not JSON. Status:', response.status);
      console.error('Response text (first 500 chars):', responseText.substring(0, 500));
      throw new Error('Server returned non-JSON response');
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('RESPONSE');
    console.log('='.repeat(80));
    console.log('\nStatus:', response.status);
    console.log('\nReply Text:', result.replyText);
    console.log('\nResolved Constraints:', JSON.stringify(result.resolvedConstraints, null, 2));
    console.log('\nProduct Count:', result.productCards?.length || 0);
    
    if (result.productCards && result.productCards.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('PRODUCTS RETURNED');
      console.log('='.repeat(80));
      result.productCards.forEach((product, index) => {
        console.log(`\n${index + 1}. ${product.title}`);
        console.log(`   ID: ${product.id}`);
        console.log(`   Price: ${product.priceCents ? `$${(product.priceCents / 100).toFixed(2)}` : 'N/A'}`);
        console.log(`   Reason: ${product.reason || 'N/A'}`);
        console.log(`   Category: ${product.category || 'N/A'}`);
        if (product.attributes) {
          console.log(`   Attributes: ${JSON.stringify(product.attributes, null, 2)}`);
        }
      });
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('ANALYSIS');
    console.log('='.repeat(80));
    console.log('\n✅ Request completed successfully');
    console.log('\n📋 Next steps:');
    console.log('   1. Check console logs for constraint extraction');
    console.log('   2. Check app.log file for detailed logs');
    console.log('   3. Verify products are actually "aline" dresses');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
  }
}

testAlineQuery();
