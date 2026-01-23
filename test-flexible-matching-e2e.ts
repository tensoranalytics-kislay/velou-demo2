import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';

const prisma = new PrismaClient();

interface TestCase {
  query: string;
  expectedConstraint: string;
  expectedValue: string;
  expectedIntent: 'required' | 'strong' | 'preferred';
  note: string;
}

const testCases: TestCase[] = [
  // Style tests with variations
  {
    query: 'do you have any aline dresses?',
    expectedConstraint: 'styles',
    expectedValue: 'A-Line',
    expectedIntent: 'required',
    note: 'Typo/case variation: "aline" → "A-Line"'
  },
  {
    query: 'show me empire waist dresses',
    expectedConstraint: 'styles',
    expectedValue: 'Empire',
    expectedIntent: 'required',
    note: 'Synonym: "empire waist" → "Empire"'
  },
  {
    query: 'I want fit and flare style dresses',
    expectedConstraint: 'styles',
    expectedValue: 'Fit and Flare',
    expectedIntent: 'required',
    note: 'Synonym: "fit and flare" → "Fit and Flare"'
  },
  {
    query: 'looking for a-line dresses',
    expectedConstraint: 'styles',
    expectedValue: 'A-Line',
    expectedIntent: 'required',
    note: 'Hyphen variation: "a-line" → "A-Line"'
  },
  
  // Sleeve length tests
  {
    query: 'I want a cap sleeve dress for summer',
    expectedConstraint: 'sleeveLengths',
    expectedValue: 'Cap',
    expectedIntent: 'required',
    note: 'Synonym: "cap sleeve" → "Cap"'
  },
  {
    query: 'show me long sleeve tops',
    expectedConstraint: 'sleeveLengths',
    expectedValue: 'Long',
    expectedIntent: 'required',
    note: 'Direct: "long sleeve" → "Long"'
  },
  {
    query: 'full sleeve dresses please',
    expectedConstraint: 'sleeveLengths',
    expectedValue: 'Long',
    expectedIntent: 'required',
    note: 'Synonym: "full sleeve" → "Long"'
  },
  {
    query: 'three quarter sleeve blouses',
    expectedConstraint: 'sleeveLengths',
    expectedValue: 'Three-Quarter',
    expectedIntent: 'required',
    note: 'Spacing variation: "three quarter" → "Three-Quarter"'
  },
  
  // Neckline tests
  {
    query: 'I need a scoop neck blouse',
    expectedConstraint: 'necklines',
    expectedValue: 'Scoop',
    expectedIntent: 'required',
    note: 'Synonym: "scoop neck" → "Scoop"'
  },
  {
    query: 'v-neck dresses',
    expectedConstraint: 'necklines',
    expectedValue: 'V-Neck',
    expectedIntent: 'required',
    note: 'Hyphen variation: "v-neck" → "V-Neck"'
  },
  {
    query: 'round neck tops',
    expectedConstraint: 'necklines',
    expectedValue: 'Round',
    expectedIntent: 'required',
    note: 'Synonym: "round neck" → "Round"'
  },
  
  // Length tests
  {
    query: 'maxi dresses',
    expectedConstraint: 'lengths',
    expectedValue: 'Maxi',
    expectedIntent: 'required',
    note: 'Direct: "maxi" → "Maxi"'
  },
  {
    query: 'ankle length dresses',
    expectedConstraint: 'lengths',
    expectedValue: 'Maxi',
    expectedIntent: 'required',
    note: 'Synonym: "ankle length" → "Maxi"'
  },
  {
    query: 'knee-length skirts',
    expectedConstraint: 'lengths',
    expectedValue: 'Midi',
    expectedIntent: 'required',
    note: 'Synonym: "knee-length" → "Midi"'
  },
  
  // Color tests
  {
    query: 'navy blue dresses',
    expectedConstraint: 'colors',
    expectedValue: 'Navy Blue',
    expectedIntent: 'required',
    note: 'Direct: "navy blue" → "Navy Blue"'
  },
  {
    query: 'show me burgundy tops',
    expectedConstraint: 'colors',
    expectedValue: 'Burgundy',
    expectedIntent: 'required',
    note: 'Direct: "burgundy" → "Burgundy"'
  },
  
  // Material tests
  {
    query: 'cotton blend shirts',
    expectedConstraint: 'materials',
    expectedValue: 'Cotton',
    expectedIntent: 'required',
    note: 'Synonym: "cotton blend" → "Cotton"'
  },
  
  // Inferred tests (should be "strong" not "required")
  {
    query: 'dress for winter',
    expectedConstraint: 'sleeveLengths',
    expectedValue: 'Long',
    expectedIntent: 'strong',
    note: 'Inferred: "winter" → sleeveLengths (not explicitly mentioned)'
  },
  {
    query: 'something cozy and warm for cold weather',
    expectedConstraint: 'materials',
    expectedValue: 'Wool',
    expectedIntent: 'strong',
    note: 'Inferred: "cozy/warm" → materials (not explicitly mentioned)'
  }
];

interface TestResult {
  query: string;
  expectedConstraint: string;
  expectedValue: string;
  expectedIntent: string;
  note: string;
  extracted: boolean;
  extractedValue: string | null;
  extractedIntent: string | null;
  productsReturned: number;
  constraintInRanking: boolean;
  constraintInResolved: boolean;
  issues: string[];
}

async function runTests() {
  console.log('🧪 TESTING FLEXIBLE MATCHING END-TO-END');
  console.log('='.repeat(100));
  console.log(`Testing ${testCases.length} queries...\n`);
  
  const results: TestResult[] = [];
  
  for (let i = 0; i < testCases.length; i++) {
    const test = testCases[i];
    console.log(`\n${'='.repeat(100)}`);
    console.log(`TEST ${i + 1}/${testCases.length}`);
    console.log(`Query: "${test.query}"`);
    console.log(`Expected: ${test.expectedConstraint} = "${test.expectedValue}" (intent: "${test.expectedIntent}")`);
    console.log(`Note: ${test.note}`);
    console.log('-'.repeat(100));
    
    const result: TestResult = {
      query: test.query,
      expectedConstraint: test.expectedConstraint,
      expectedValue: test.expectedValue,
      expectedIntent: test.expectedIntent,
      note: test.note,
      extracted: false,
      extractedValue: null,
      extractedIntent: null,
      productsReturned: 0,
      constraintInRanking: false,
      constraintInResolved: false,
      issues: []
    };
    
    try {
      const startTime = Date.now();
      const handleResult = await handleLoveshackfancyQuery({
        message: test.query,
        sessionId: `test-flexible-${i}-${Date.now()}`,
        merchantId: 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
      });
      
      const duration = Date.now() - startTime;
      result.productsReturned = handleResult.productCards?.length || 0;
      
      // Check constraints in both locations
      const rankingConstraints = handleResult.constraintsPassedToRanking || {};
      const resolvedConstraints = handleResult.resolvedConstraints || {};
      
      const constraintInRanking = rankingConstraints[test.expectedConstraint as keyof typeof rankingConstraints];
      const constraintInResolved = resolvedConstraints[test.expectedConstraint as keyof typeof resolvedConstraints];
      
      result.constraintInRanking = constraintInRanking !== undefined && constraintInRanking !== null;
      result.constraintInResolved = constraintInResolved !== undefined && constraintInResolved !== null;
      
      // Extract the actual value and intent
      const constraint = constraintInRanking || constraintInResolved;
      
      if (constraint) {
        result.extracted = true;
        
        if (typeof constraint === 'object' && constraint !== null && 'values' in constraint) {
          const values = (constraint as any).values || [];
          const intent = (constraint as any).intent;
          
          result.extractedValue = values.find((v: string) => 
            v.toLowerCase().replace(/[-\s]/g, '') === test.expectedValue.toLowerCase().replace(/[-\s]/g, '')
          ) || values[0] || null;
          result.extractedIntent = intent || null;
          
          if (result.extractedValue) {
            // Check if value matches (flexible matching)
            const normalizedExtracted = result.extractedValue.toLowerCase().replace(/[-\s]/g, '');
            const normalizedExpected = test.expectedValue.toLowerCase().replace(/[-\s]/g, '');
            
            if (normalizedExtracted === normalizedExpected) {
              console.log(`✅ Constraint extracted correctly: ${test.expectedConstraint} = "${result.extractedValue}"`);
            } else {
              result.issues.push(`⚠️  Value mismatch: expected "${test.expectedValue}", got "${result.extractedValue}"`);
              console.log(`⚠️  Value mismatch: expected "${test.expectedValue}", got "${result.extractedValue}"`);
            }
            
            // Check intent
            if (result.extractedIntent === test.expectedIntent) {
              console.log(`✅ Intent correct: "${result.extractedIntent}"`);
            } else {
              result.issues.push(`⚠️  Intent mismatch: expected "${test.expectedIntent}", got "${result.extractedIntent}"`);
              console.log(`⚠️  Intent mismatch: expected "${test.expectedIntent}", got "${result.extractedIntent}"`);
            }
          } else {
            result.issues.push(`⚠️  Expected value "${test.expectedValue}" not found in extracted values: ${JSON.stringify(values)}`);
            console.log(`⚠️  Expected value not found. Extracted values: ${JSON.stringify(values)}`);
          }
        } else if (Array.isArray(constraint)) {
          result.extractedValue = constraint.find((v: string) => 
            v.toLowerCase().replace(/[-\s]/g, '') === test.expectedValue.toLowerCase().replace(/[-\s]/g, '')
          ) || constraint[0] || null;
          result.extractedIntent = null;
          result.issues.push(`⚠️  Constraint in array format (no intent): ${JSON.stringify(constraint)}`);
          console.log(`⚠️  Constraint in array format (no intent): ${JSON.stringify(constraint)}`);
        }
      } else {
        result.issues.push(`❌ Constraint "${test.expectedConstraint}" not extracted`);
        console.log(`❌ Constraint "${test.expectedConstraint}" not extracted`);
        console.log(`   Available constraints in ranking: ${Object.keys(rankingConstraints).join(', ') || 'none'}`);
        console.log(`   Available constraints in resolved: ${Object.keys(resolvedConstraints).join(', ') || 'none'}`);
      }
      
      console.log(`\n📊 Results:`);
      console.log(`   Products returned: ${result.productsReturned}`);
      console.log(`   Constraint in ranking: ${result.constraintInRanking}`);
      console.log(`   Constraint in resolved: ${result.constraintInResolved}`);
      console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
      
      if (result.productsReturned > 0) {
        console.log(`\n📦 Top 3 Products:`);
        handleResult.productCards?.slice(0, 3).forEach((p, idx) => {
          console.log(`   ${idx + 1}. ${p.title}`);
        });
      }
      
    } catch (error) {
      result.issues.push(`❌ Error: ${error}`);
      console.error(`❌ Error:`, error);
    }
    
    results.push(result);
    
    // Wait between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Summary
  console.log(`\n\n${'='.repeat(100)}`);
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(100));
  
  const passed = results.filter(r => r.extracted && r.extractedValue && 
    r.extractedValue.toLowerCase().replace(/[-\s]/g, '') === r.expectedValue.toLowerCase().replace(/[-\s]/g, '') &&
    r.extractedIntent === r.expectedIntent).length;
  
  const extractedButWrong = results.filter(r => r.extracted && r.extractedValue && 
    (r.extractedValue.toLowerCase().replace(/[-\s]/g, '') !== r.expectedValue.toLowerCase().replace(/[-\s]/g, '') ||
     r.extractedIntent !== r.expectedIntent)).length;
  
  const notExtracted = results.filter(r => !r.extracted).length;
  
  console.log(`\n✅ Fully Passed: ${passed}/${results.length}`);
  console.log(`⚠️  Extracted but Issues: ${extractedButWrong}/${results.length}`);
  console.log(`❌ Not Extracted: ${notExtracted}/${results.length}`);
  
  console.log(`\n📋 Detailed Results:`);
  results.forEach((r, i) => {
    const status = r.extracted && r.extractedValue && 
      r.extractedValue.toLowerCase().replace(/[-\s]/g, '') === r.expectedValue.toLowerCase().replace(/[-\s]/g, '') &&
      r.extractedIntent === r.expectedIntent ? '✅' : 
      r.extracted ? '⚠️' : '❌';
    
    console.log(`\n${status} Test ${i + 1}: "${r.query}"`);
    console.log(`   Expected: ${r.expectedConstraint} = "${r.expectedValue}" (${r.expectedIntent})`);
    if (r.extracted) {
      console.log(`   Extracted: ${r.expectedConstraint} = "${r.extractedValue}" (${r.extractedIntent || 'no intent'})`);
    } else {
      console.log(`   Extracted: NOT FOUND`);
    }
    if (r.issues.length > 0) {
      r.issues.forEach(issue => console.log(`   ${issue}`));
    }
    console.log(`   Products: ${r.productsReturned}`);
  });
  
  // Save results
  const output = {
    summary: {
      total: results.length,
      passed,
      extractedButWrong,
      notExtracted,
      passRate: `${((passed / results.length) * 100).toFixed(1)}%`
    },
    results
  };
  
  writeFileSync('test-flexible-matching-results.json', JSON.stringify(output, null, 2));
  console.log(`\n💾 Results saved to test-flexible-matching-results.json`);
  
  await prisma.$disconnect();
}

runTests().catch(console.error);
