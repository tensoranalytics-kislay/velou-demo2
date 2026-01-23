import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { logger } from './src/lib/telemetry/logger';

async function testSynonymVsInferred() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  // 4 prompts using synonyms (direct interpretation → should be "required")
  const synonymPrompts = [
    "I want a three-quarter sleeve blouse", // Synonym for sleeve length
    "show me high-waisted jeans", // Synonym for rise
    "I need a boat neck top", // Synonym for neckline
    "looking for a midi length skirt" // Synonym for length
  ];
  
  // 4 prompts using indirect/inferred language (inferred interpretation → should be "strong"/"preferred")
  const inferredPrompts = [
    "I need something warm for winter", // Inferred: materials (wool/cashmere), colors (dark), sleeveLengths (long)
    "show me something comfortable for everyday wear", // Inferred: fits (relaxed), materials (cotton), styles (casual)
    "I want something elegant for a formal event", // Inferred: styles (elegant), formalityLevel (formal), embellishments (lace)
    "looking for something appropriate for office meetings" // Inferred: formalityLevel (professional), styles (classic), occasions (office)
  ];
  
  console.log('='.repeat(80));
  console.log('TESTING SYNONYM PROMPTS (Direct Interpretation → "required" intent)');
  console.log('='.repeat(80));
  console.log();
  
  for (let i = 0; i < synonymPrompts.length; i++) {
    const query = synonymPrompts[i];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SYNONYM PROMPT ${i + 1}: "${query}"`);
    console.log('='.repeat(80));
    
    const startTime = Date.now();
    
    try {
      const result = await handleLoveshackfancyQuery({
        message: query,
        sessionId: `test-synonym-${i + 1}-${Date.now()}`,
        merchantId: merchantId,
      });
      
      const duration = Date.now() - startTime;
      const productCards = result.productCards || [];
      
      console.log(`✅ Completed in ${(duration / 1000).toFixed(2)}s`);
      console.log(`📊 Products returned: ${productCards.length}`);
      
      if (result.resolvedConstraints) {
        console.log(`\n📋 Resolved Constraints:`);
        console.log(JSON.stringify(result.resolvedConstraints, null, 2));
      }
      
      if (productCards.length > 0) {
        console.log(`\n📦 Top Products:`);
        productCards.slice(0, 3).forEach((p, idx) => {
          console.log(`  ${idx + 1}. ${p.title}`);
        });
      }
      
    } catch (error) {
      console.error(`❌ Error:`, error);
    }
    
    // Wait a bit between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n\n');
  console.log('='.repeat(80));
  console.log('TESTING INFERRED PROMPTS (Inferred Interpretation → "strong"/"preferred" intent)');
  console.log('='.repeat(80));
  console.log();
  
  for (let i = 0; i < inferredPrompts.length; i++) {
    const query = inferredPrompts[i];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`INFERRED PROMPT ${i + 1}: "${query}"`);
    console.log('='.repeat(80));
    
    const startTime = Date.now();
    
    try {
      const result = await handleLoveshackfancyQuery({
        message: query,
        sessionId: `test-inferred-${i + 1}-${Date.now()}`,
        merchantId: merchantId,
      });
      
      const duration = Date.now() - startTime;
      const productCards = result.productCards || [];
      
      console.log(`✅ Completed in ${(duration / 1000).toFixed(2)}s`);
      console.log(`📊 Products returned: ${productCards.length}`);
      
      if (result.resolvedConstraints) {
        console.log(`\n📋 Resolved Constraints:`);
        console.log(JSON.stringify(result.resolvedConstraints, null, 2));
      }
      
      if (productCards.length > 0) {
        console.log(`\n📦 Top Products:`);
        productCards.slice(0, 3).forEach((p, idx) => {
          console.log(`  ${idx + 1}. ${p.title}`);
        });
      }
      
    } catch (error) {
      console.error(`❌ Error:`, error);
    }
    
    // Wait a bit between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n\n');
  console.log('='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
  
  process.exit(0);
}

testSynonymVsInferred().catch(console.error);
