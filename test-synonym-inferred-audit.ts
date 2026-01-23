import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { logger } from './src/lib/telemetry/logger';

interface TestResult {
  query: string;
  type: 'synonym' | 'inferred';
  duration: number;
  productCount: number;
  constraints: any;
  topProducts: string[];
  issues: string[];
}

async function testSynonymAndInferredPrompts() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  // 4 prompts using synonyms for constraints NOT in current examples
  // These should be DIRECT interpretation → "required" intent
  const synonymPrompts = [
    {
      query: "I want a cap sleeve dress for summer",
      expectedConstraint: "sleeveLengths",
      expectedValue: "Cap Sleeve",
      expectedIntent: "required",
      note: "Synonym: 'cap sleeve' → 'Cap Sleeve' (direct interpretation)"
    },
    {
      query: "show me empire waist dresses",
      expectedConstraint: "styles",
      expectedValue: "Empire Waist",
      expectedIntent: "required",
      note: "Synonym: 'empire waist' → 'Empire Waist' (direct interpretation)"
    },
    {
      query: "I need a scoop neck blouse",
      expectedConstraint: "necklines",
      expectedValue: "Scoop",
      expectedIntent: "required",
      note: "Synonym: 'scoop neck' → 'Scoop' (direct interpretation)"
    },
    {
      query: "looking for fit and flare style dresses",
      expectedConstraint: "styles",
      expectedValue: "Fit and Flare",
      expectedIntent: "required",
      note: "Synonym: 'fit and flare' → 'Fit and Flare' (direct interpretation)"
    }
  ];
  
  // 4 prompts using indirect/inferred language (human-like with edge cases)
  // These should be INFERRED interpretation → "strong"/"preferred" intent
  const inferredPrompts = [
    {
      query: "I need something cozy and warm for cold weather",
      expectedConstraints: ["materials", "sleeveLengths", "colors"],
      expectedIntent: "strong",
      note: "Inferred: 'cozy/warm' → materials (wool/cashmere), 'cold weather' → sleeveLengths (long), colors (dark)"
    },
    {
      query: "what would work for a first date?",
      expectedConstraints: ["occasions", "styles", "formalityLevel"],
      expectedIntent: "strong",
      note: "Inferred: 'first date' → occasions (Date Night), styles (Romantic/Elegant), formalityLevel (Semi-Formal)"
    },
    {
      query: "I'm going to a business meeting, need something professional",
      expectedConstraints: ["formalityLevel", "styles", "occasions"],
      expectedIntent: "strong",
      note: "Inferred: 'business meeting' → formalityLevel (Professional), styles (Classic), occasions (Office)"
    },
    {
      query: "something that won't wrinkle when I travel",
      expectedConstraints: ["materials", "travelFeatures"],
      expectedIntent: "strong",
      note: "Inferred: 'won't wrinkle' → materials (synthetic blends), travelFeatures (wrinkle-free)"
    }
  ];
  
  const results: TestResult[] = [];
  
  console.log('='.repeat(100));
  console.log('COMPREHENSIVE SYNONYM vs INFERRED INTERPRETATION TEST');
  console.log('='.repeat(100));
  console.log();
  
  // Test synonym prompts
  console.log('🔍 TESTING SYNONYM PROMPTS (Direct Interpretation → "required" intent)');
  console.log('='.repeat(100));
  console.log();
  
  for (let i = 0; i < synonymPrompts.length; i++) {
    const test = synonymPrompts[i];
    console.log(`\n${'─'.repeat(100)}`);
    console.log(`SYNONYM TEST ${i + 1}/${synonymPrompts.length}`);
    console.log(`Query: "${test.query}"`);
    console.log(`Expected: ${test.expectedConstraint} = "${test.expectedValue}" with intent "${test.expectedIntent}"`);
    console.log(`Note: ${test.note}`);
    console.log('─'.repeat(100));
    
    const startTime = Date.now();
    const issues: string[] = [];
    
    try {
      const result = await handleLoveshackfancyQuery({
        message: test.query,
        sessionId: `test-synonym-${i + 1}-${Date.now()}`,
        merchantId: merchantId,
      });
      
      const duration = Date.now() - startTime;
      const productCards = result.productCards || [];
      
      // Analyze constraints
      const constraints = result.resolvedConstraints || {};
      const allConstraints = result.constraintsPassedToRanking || {};
      
      console.log(`\n⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`📊 Products returned: ${productCards.length}`);
      
      // Check if expected constraint was extracted
      const constraintValue = allConstraints[test.expectedConstraint] || constraints[test.expectedConstraint];
      const hasConstraint = constraintValue !== undefined && constraintValue !== null;
      
      console.log(`\n📋 Constraint Extraction:`);
      console.log(`   Expected: ${test.expectedConstraint} = "${test.expectedValue}" (intent: "${test.expectedIntent}")`);
      console.log(`   Extracted: ${hasConstraint ? JSON.stringify(constraintValue) : 'NOT FOUND'}`);
      
      if (!hasConstraint) {
        issues.push(`❌ Expected constraint "${test.expectedConstraint}" not extracted`);
      } else {
        // Check if it's in the right format (with intent)
        if (typeof constraintValue === 'object' && constraintValue !== null && 'intent' in constraintValue) {
          const intent = constraintValue.intent;
          const values = constraintValue.values || [];
          if (intent !== test.expectedIntent) {
            issues.push(`⚠️  Intent mismatch: expected "${test.expectedIntent}", got "${intent}"`);
          }
          if (!values.includes(test.expectedValue)) {
            issues.push(`⚠️  Value mismatch: expected "${test.expectedValue}", got ${JSON.stringify(values)}`);
          } else {
            console.log(`   ✅ Constraint correctly extracted with intent "${intent}"`);
          }
        } else if (Array.isArray(constraintValue)) {
          if (!constraintValue.includes(test.expectedValue)) {
            issues.push(`⚠️  Value mismatch: expected "${test.expectedValue}", got ${JSON.stringify(constraintValue)}`);
          } else {
            issues.push(`⚠️  Constraint extracted but missing intent (should be "${test.expectedIntent}")`);
          }
        }
      }
      
      // Show all extracted constraints
      console.log(`\n📋 All Extracted Constraints:`);
      console.log(JSON.stringify(allConstraints, null, 2));
      
      if (productCards.length > 0) {
        console.log(`\n📦 Top Products:`);
        productCards.slice(0, 3).forEach((p, idx) => {
          console.log(`   ${idx + 1}. ${p.title}`);
        });
      } else {
        issues.push(`⚠️  No products returned`);
      }
      
      results.push({
        query: test.query,
        type: 'synonym',
        duration,
        productCount: productCards.length,
        constraints: allConstraints,
        topProducts: productCards.slice(0, 3).map(p => p.title),
        issues
      });
      
    } catch (error) {
      console.error(`❌ Error:`, error);
      results.push({
        query: test.query,
        type: 'synonym',
        duration: 0,
        productCount: 0,
        constraints: {},
        topProducts: [],
        issues: [`❌ Error: ${error}`]
      });
    }
    
    // Wait between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Test inferred prompts
  console.log('\n\n');
  console.log('🔍 TESTING INFERRED PROMPTS (Inferred Interpretation → "strong"/"preferred" intent)');
  console.log('='.repeat(100));
  console.log();
  
  for (let i = 0; i < inferredPrompts.length; i++) {
    const test = inferredPrompts[i];
    console.log(`\n${'─'.repeat(100)}`);
    console.log(`INFERRED TEST ${i + 1}/${inferredPrompts.length}`);
    console.log(`Query: "${test.query}"`);
    console.log(`Expected: ${test.expectedConstraints.join(', ')} with intent "${test.expectedIntent}"`);
    console.log(`Note: ${test.note}`);
    console.log('─'.repeat(100));
    
    const startTime = Date.now();
    const issues: string[] = [];
    
    try {
      const result = await handleLoveshackfancyQuery({
        message: test.query,
        sessionId: `test-inferred-${i + 1}-${Date.now()}`,
        merchantId: merchantId,
      });
      
      const duration = Date.now() - startTime;
      const productCards = result.productCards || [];
      
      // Analyze constraints
      const constraints = result.resolvedConstraints || {};
      const allConstraints = result.constraintsPassedToRanking || {};
      
      console.log(`\n⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`📊 Products returned: ${productCards.length}`);
      
      // Check if expected constraints were extracted
      console.log(`\n📋 Constraint Extraction:`);
      console.log(`   Expected constraints: ${test.expectedConstraints.join(', ')} (intent: "${test.expectedIntent}")`);
      
      let foundCount = 0;
      for (const constraintType of test.expectedConstraints) {
        const constraintValue = allConstraints[constraintType] || constraints[constraintType];
        const hasConstraint = constraintValue !== undefined && constraintValue !== null;
        
        if (hasConstraint) {
          foundCount++;
          if (typeof constraintValue === 'object' && constraintValue !== null && 'intent' in constraintValue) {
            const intent = constraintValue.intent;
            if (intent === 'required') {
              issues.push(`⚠️  "${constraintType}" extracted with "required" intent (should be "${test.expectedIntent}" for inferred)`);
            } else {
              console.log(`   ✅ ${constraintType}: extracted with intent "${intent}"`);
            }
          } else {
            console.log(`   ✅ ${constraintType}: extracted (format: ${Array.isArray(constraintValue) ? 'array' : typeof constraintValue})`);
          }
        } else {
          issues.push(`⚠️  Expected constraint "${constraintType}" not extracted`);
        }
      }
      
      if (foundCount === 0) {
        issues.push(`❌ None of the expected constraints were extracted`);
      }
      
      // Show all extracted constraints
      console.log(`\n📋 All Extracted Constraints:`);
      console.log(JSON.stringify(allConstraints, null, 2));
      
      if (productCards.length > 0) {
        console.log(`\n📦 Top Products:`);
        productCards.slice(0, 3).forEach((p, idx) => {
          console.log(`   ${idx + 1}. ${p.title}`);
        });
      } else {
        issues.push(`⚠️  No products returned`);
      }
      
      results.push({
        query: test.query,
        type: 'inferred',
        duration,
        productCount: productCards.length,
        constraints: allConstraints,
        topProducts: productCards.slice(0, 3).map(p => p.title),
        issues
      });
      
    } catch (error) {
      console.error(`❌ Error:`, error);
      results.push({
        query: test.query,
        type: 'inferred',
        duration: 0,
        productCount: 0,
        constraints: {},
        topProducts: [],
        issues: [`❌ Error: ${error}`]
      });
    }
    
    // Wait between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Summary
  console.log('\n\n');
  console.log('='.repeat(100));
  console.log('TEST SUMMARY');
  console.log('='.repeat(100));
  console.log();
  
  const synonymResults = results.filter(r => r.type === 'synonym');
  const inferredResults = results.filter(r => r.type === 'inferred');
  
  console.log(`📊 Synonym Tests: ${synonymResults.length} total`);
  const synonymIssues = synonymResults.filter(r => r.issues.length > 0);
  console.log(`   ✅ Passed: ${synonymResults.length - synonymIssues.length}`);
  console.log(`   ⚠️  Issues: ${synonymIssues.length}`);
  
  console.log(`\n📊 Inferred Tests: ${inferredResults.length} total`);
  const inferredIssues = inferredResults.filter(r => r.issues.length > 0);
  console.log(`   ✅ Passed: ${inferredResults.length - inferredIssues.length}`);
  console.log(`   ⚠️  Issues: ${inferredIssues.length}`);
  
  console.log(`\n📋 Detailed Issues:`);
  results.forEach((r, idx) => {
    if (r.issues.length > 0) {
      console.log(`\n   Test ${idx + 1} (${r.type}): "${r.query}"`);
      r.issues.forEach(issue => console.log(`      ${issue}`));
    }
  });
  
  console.log('\n\n');
  console.log('='.repeat(100));
  console.log('TEST COMPLETE');
  console.log('='.repeat(100));
  
  // Save results to file
  const fs = require('fs');
  fs.writeFileSync(
    'test-synonym-inferred-results.json',
    JSON.stringify(results, null, 2)
  );
  console.log('\n💾 Results saved to test-synonym-inferred-results.json');
  
  process.exit(0);
}

testSynonymAndInferredPrompts().catch(console.error);
