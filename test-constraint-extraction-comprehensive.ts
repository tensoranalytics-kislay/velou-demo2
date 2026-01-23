import { handleLoveshackfancyQuery } from './src/lib/loveshackfancy/orchestrator';

interface TestCase {
  query: string;
  expectedConstraints: {
    type: string;
    value: string | string[];
    intent: 'required' | 'strong' | 'preferred';
  }[];
  description: string;
}

const testCases: TestCase[] = [
  {
    query: "I need a scoop neck blouse",
    expectedConstraints: [
      { type: "necklines", value: "Scoop", intent: "required" }
    ],
    description: "Direct synonym: scoop neck → Scoop"
  },
  {
    query: "show me round neck tops",
    expectedConstraints: [
      { type: "necklines", value: "Round", intent: "required" }
    ],
    description: "Direct synonym: round neck → Round"
  },
  {
    query: "burgundy dresses please",
    expectedConstraints: [
      { type: "colors", value: "Burgundy", intent: "required" }
    ],
    description: "Direct color: burgundy → Burgundy"
  },
  {
    query: "navy blue maxi dresses",
    expectedConstraints: [
      { type: "colors", value: "Navy Blue", intent: "required" },
      { type: "lengths", value: "Maxi", intent: "required" }
    ],
    description: "Multiple constraints: navy blue + maxi"
  },
  {
    query: "dress for winter",
    expectedConstraints: [
      { type: "seasons", value: "Winter", intent: "required" },
      { type: "sleeveLengths", value: "Long", intent: "strong" }
    ],
    description: "Inferred constraint: winter → long sleeves"
  },
  {
    query: "something cozy and warm for cold weather",
    expectedConstraints: [
      { type: "materials", value: ["Wool", "Cashmere"], intent: "strong" },
      { type: "sleeveLengths", value: "Long", intent: "strong" }
    ],
    description: "Inferred constraints: cozy/warm → wool/cashmere, cold → long sleeves"
  },
  {
    query: "empire waist dress",
    expectedConstraints: [
      { type: "styles", value: "Empire", intent: "required" }
    ],
    description: "Direct synonym: empire waist → Empire"
  },
  {
    query: "fit and flare style dresses",
    expectedConstraints: [
      { type: "styles", value: "Fit and Flare", intent: "required" }
    ],
    description: "Direct synonym: fit and flare → Fit and Flare"
  },
  {
    query: "cap sleeve summer dress",
    expectedConstraints: [
      { type: "sleeveLengths", value: "Cap", intent: "required" },
      { type: "seasons", value: "Summer", intent: "required" }
    ],
    description: "Multiple constraints: cap sleeve + summer"
  },
  {
    query: "v-neck dress for beach",
    expectedConstraints: [
      { type: "necklines", value: "V-Neck", intent: "required" },
      { type: "occasions", value: "Beach", intent: "required" }
    ],
    description: "Multiple constraints: v-neck + beach"
  }
];

async function runTests() {
  console.log('='.repeat(100));
  console.log('COMPREHENSIVE CONSTRAINT EXTRACTION TEST');
  console.log('='.repeat(100));
  console.log();

  const results: Array<{
    query: string;
    passed: boolean;
    extracted: any;
    expected: any;
    products: number;
    issues: string[];
  }> = [];

  for (let i = 0; i < testCases.length; i++) {
    const test = testCases[i];
    console.log(`\n${'='.repeat(100)}`);
    console.log(`Test ${i + 1}/${testCases.length}: "${test.query}"`);
    console.log(`Expected: ${test.description}`);
    console.log('-'.repeat(100));

    try {
      const result = await handleLoveshackfancyQuery({
        message: test.query,
        sessionId: `test-comprehensive-${Date.now()}-${i}`,
        merchantId: 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
      });

      const extractedConstraints = result.constraintsPassedToRanking || {};
      const resolvedConstraints = result.resolvedConstraints || {};
      const productCount = result.productCards?.length || 0;

      const issues: string[] = [];
      let allPassed = true;

      for (const expected of test.expectedConstraints) {
        const constraintType = expected.type;
        const expectedValue = Array.isArray(expected.value) ? expected.value : [expected.value];
        const expectedIntent = expected.intent;

        // Check in constraintsPassedToRanking first
        let extractedValue: any = extractedConstraints[constraintType];
        if (!extractedValue && resolvedConstraints) {
          // Fallback to resolvedConstraints
          if (constraintType === 'styles') {
            extractedValue = resolvedConstraints.styleTags;
          } else if (constraintType === 'sleeveLengths') {
            extractedValue = resolvedConstraints.sleeves;
          } else {
            extractedValue = (resolvedConstraints as any)[constraintType];
          }
        }

        // Extract values from intent format
        let extractedValues: string[] = [];
        let extractedIntent: string | undefined;
        
        if (Array.isArray(extractedValue)) {
          extractedValues = extractedValue;
        } else if (extractedValue && typeof extractedValue === 'object' && 'values' in extractedValue) {
          extractedValues = extractedValue.values || [];
          extractedIntent = extractedValue.intent;
        }

        const hasValue = expectedValue.some(ev => 
          extractedValues.some(extracted => 
            extracted.toLowerCase() === ev.toLowerCase()
          )
        );

        const hasCorrectIntent = !expectedIntent || extractedIntent === expectedIntent;

        if (!hasValue) {
          issues.push(`Missing ${constraintType}: expected ${expectedValue.join(' or ')}, got ${extractedValues.join(', ') || 'NOT FOUND'}`);
          allPassed = false;
        } else if (!hasCorrectIntent && expectedIntent === 'required') {
          issues.push(`Wrong intent for ${constraintType}: expected "${expectedIntent}", got "${extractedIntent || 'none'}"`);
          allPassed = false;
        } else {
          console.log(`  ✅ ${constraintType}: ${extractedValues.join(', ')} (intent: ${extractedIntent || 'none'})`);
        }
      }

      if (allPassed) {
        console.log(`\n✅ PASSED - Products: ${productCount}`);
      } else {
        console.log(`\n❌ FAILED - Products: ${productCount}`);
        issues.forEach(issue => console.log(`  ❌ ${issue}`));
      }

      results.push({
        query: test.query,
        passed: allPassed,
        extracted: extractedConstraints,
        expected: test.expectedConstraints,
        products: productCount,
        issues
      });

      // Show top 3 products if available
      if (result.productCards && result.productCards.length > 0) {
        console.log(`\n  Top ${Math.min(3, result.productCards.length)} products:`);
        result.productCards.slice(0, 3).forEach((p, idx) => {
          console.log(`    ${idx + 1}. ${p.title}`);
        });
      }

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`\n❌ ERROR: ${error instanceof Error ? error.message : String(error)}`);
      results.push({
        query: test.query,
        passed: false,
        extracted: {},
        expected: test.expectedConstraints,
        products: 0,
        issues: [error instanceof Error ? error.message : String(error)]
      });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(100));
  console.log('TEST SUMMARY');
  console.log('='.repeat(100));
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`\nPassed: ${passed}/${total} (${Math.round(passed / total * 100)}%)`);
  console.log(`\nDetailed Results:`);
  results.forEach((r, i) => {
    const status = r.passed ? '✅' : '❌';
    console.log(`${status} Test ${i + 1}: "${r.query}" - Products: ${r.products}`);
    if (!r.passed && r.issues.length > 0) {
      r.issues.forEach(issue => console.log(`    ${issue}`));
    }
  });

  return results;
}

runTests().catch(console.error);
