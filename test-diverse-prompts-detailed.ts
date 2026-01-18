#!/usr/bin/env tsx

/**
 * Comprehensive Test with 5 Diverse Prompts
 * Checks categories, gender filtering, dictionary matching, and constraints
 */

interface TestCase {
  id: string;
  query: string;
  description: string;
  type: 'problem-oriented' | 'situation-context' | 'occasion' | 'complementing' | 'style-preference';
  expectedGender?: 'male' | 'female';
  expectedCategory?: string[];
}

const TEST_CASES: TestCase[] = [
  {
    id: 'diverse-test-1',
    query: "I am a curvy mom, suggest me something to wear",
    description: "Problem-oriented: Body type + role-based query",
    type: 'problem-oriented',
    expectedGender: 'female',
    expectedCategory: ['Women\'s Dresses', 'Tops', 'Womens-pants'],
  },
  {
    id: 'diverse-test-2',
    query: "I am going to Bahamas for vacation, suggest me a dress",
    description: "Situation/context-oriented: Travel destination + product type",
    type: 'situation-context',
    expectedGender: 'female',
    expectedCategory: ['Women\'s Dresses', 'Maxi Dress'],
  },
  {
    id: 'diverse-test-3',
    query: "attending a black tie wedding, suggest me a dress",
    description: "Occasion-oriented: Formal event + product type",
    type: 'occasion',
    expectedGender: 'female',
    expectedCategory: ['Women\'s Dresses', 'Maxi Dress'],
  },
  {
    id: 'diverse-test-4',
    query: "I have dr.martens high top chelsea shoes, suggest me a dress that goes well with it",
    description: "Complementing looks: Existing item + matching product",
    type: 'complementing',
    expectedGender: 'female',
    expectedCategory: ['Women\'s Dresses'],
  },
  {
    id: 'diverse-test-5',
    query: "I want something elegant and flowy for a summer garden party",
    description: "Style-preference: Aesthetic + occasion",
    type: 'style-preference',
    expectedGender: 'female',
    expectedCategory: ['Women\'s Dresses', 'Maxi Dress'],
  },
];

async function testQuery(testCase: TestCase): Promise<any> {
  try {
    const response = await fetch('http://localhost:3000/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: testCase.id,
        message: testCase.query,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error testing "${testCase.query}":`, error);
    throw error;
  }
}

async function extractLogs(testCase: TestCase): Promise<string> {
  const { execSync } = require('child_process');
  try {
    const logs = execSync(
      `tail -5000 app.log 2>/dev/null | grep -E "${testCase.id}" | head -200`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    return logs;
  } catch (error) {
    return '';
  }
}

function analyzePipelineDetails(logs: string, testCase: TestCase): any {
  const analysis: any = {
    genderExtraction: null,
    categoriesBeforeFilter: null,
    categoriesAfterFilter: null,
    categoryClassification: null,
    categoryMapping: null,
    dictionaryRefinement: null,
    constraintsExtracted: null,
    genderFilterApplied: null,
    retrievalPath: null,
    productsReturned: null,
  };

  // Gender extraction
  const genderMatch = logs.match(/gender_and_agegroup_extracted_early.*?"resolvedGender":"([^"]+)"|"resolvedGender":\s*"([^"]+)"/);
  analysis.genderExtraction = genderMatch ? (genderMatch[1] || genderMatch[2]) : null;

  // Categories before filter
  const beforeFilterMatch = logs.match(/categories_filtered_before_classification.*?"totalCategories":(\d+)/);
  analysis.categoriesBeforeFilter = beforeFilterMatch ? parseInt(beforeFilterMatch[1]) : null;

  // Category classification
  const categoryMatch = logs.match(/category_classification_complete.*?"categories":\["([^"]+)"\]|"categories":\s*\["([^"]+)"\]/);
  if (categoryMatch) {
    const categoriesStr = categoryMatch[1] || categoryMatch[2];
    analysis.categoryClassification = categoriesStr ? categoriesStr.split('","') : [];
  }

  // Category mapping
  const mappingMatch = logs.match(/mapped_invalid_category.*?"original":"([^"]+)".*?"mapped":"([^"]+)"/);
  if (mappingMatch) {
    analysis.categoryMapping = {
      original: mappingMatch[1],
      mapped: mappingMatch[2],
    };
  }

  // Categories after gender filter
  const afterFilterMatch = logs.match(/categories_filtered_by_gender_after_classification.*?"filteredCategories":\["([^"]+)"\]|"filteredCategories":\s*\["([^"]+)"\]/);
  if (afterFilterMatch) {
    const categoriesStr = afterFilterMatch[1] || afterFilterMatch[2];
    analysis.categoriesAfterFilter = categoriesStr ? categoriesStr.split('","') : [];
  }

  // Dictionary refinement
  const dictMatch = logs.match(/dictionary_refinement_complete_before_retrieval|constraint_refinement_complete/);
  analysis.dictionaryRefinement = !!dictMatch;

  // Constraints extracted
  const constraintsMatch = logs.match(/orchestrator_resolved_constraints.*?"resolvedConstraints":({[^}]+})/);
  if (constraintsMatch) {
    try {
      analysis.constraintsExtracted = JSON.parse(constraintsMatch[1]);
    } catch (e) {
      // Try to extract individual constraints
      const colorsMatch = logs.match(/"colors":\["([^"]+)"\]/);
      const fitsMatch = logs.match(/"fits":\{[^}]*"values":\["([^"]+)"\]/);
      analysis.constraintsExtracted = {
        colors: colorsMatch ? colorsMatch[1].split('","') : null,
        fits: fitsMatch ? fitsMatch[1].split('","') : null,
      };
    }
  }

  // Gender filter applied
  analysis.genderFilterApplied = logs.includes('gender_hard_filter_applied_to_retrieval');

  // Retrieval path
  if (logs.includes('fallback_no_categories')) {
    analysis.retrievalPath = 'fallback';
  } else if (logs.includes('tier1_success')) {
    analysis.retrievalPath = 'tier1';
  } else if (logs.includes('tier2')) {
    analysis.retrievalPath = 'tier2';
  }

  return analysis;
}

async function analyzeResults(results: any, testCase: TestCase, pipelineInfo: any): Promise<void> {
  const products = results.productCards || [];
  
  console.log(`\n${'='.repeat(100)}`);
  console.log(`📋 Test: ${testCase.id} - ${testCase.description}`);
  console.log(`   Query: "${testCase.query}"`);
  console.log(`   Type: ${testCase.type}`);
  console.log(`${'='.repeat(100)}`);
  
  // Gender Extraction
  console.log(`\n🔍 Gender Extraction:`);
  console.log(`   Extracted: ${pipelineInfo.genderExtraction || 'null'}`);
  if (testCase.expectedGender) {
    const match = pipelineInfo.genderExtraction === testCase.expectedGender;
    console.log(`   Expected: ${testCase.expectedGender} ${match ? '✅' : '❌'}`);
  }
  
  // Category Classification
  console.log(`\n📂 Category Classification:`);
  console.log(`   Categories Before Filter: ${pipelineInfo.categoriesBeforeFilter || 'N/A'}`);
  console.log(`   Classified Categories: ${pipelineInfo.categoryClassification?.join(', ') || 'none'}`);
  if (testCase.expectedCategory) {
    const hasExpected = testCase.expectedCategory.some(cat => 
      pipelineInfo.categoryClassification?.some((c: string) => c.includes(cat) || cat.includes(c))
    );
    console.log(`   Expected Categories: ${testCase.expectedCategory.join(', ')} ${hasExpected ? '✅' : '⚠️'}`);
  }
  if (pipelineInfo.categoryMapping) {
    console.log(`   Category Mapping: "${pipelineInfo.categoryMapping.original}" → "${pipelineInfo.categoryMapping.mapped}"`);
  }
  console.log(`   Categories After Gender Filter: ${pipelineInfo.categoriesAfterFilter?.join(', ') || 'none'}`);
  
  // Dictionary & Constraints
  console.log(`\n📚 Dictionary & Constraints:`);
  console.log(`   Dictionary Refinement: ${pipelineInfo.dictionaryRefinement ? '✅' : '❌'}`);
  if (pipelineInfo.constraintsExtracted) {
    console.log(`   Extracted Constraints:`);
    if (pipelineInfo.constraintsExtracted.colors) {
      console.log(`     - Colors: ${Array.isArray(pipelineInfo.constraintsExtracted.colors) ? pipelineInfo.constraintsExtracted.colors.join(', ') : pipelineInfo.constraintsExtracted.colors}`);
    }
    if (pipelineInfo.constraintsExtracted.fits) {
      console.log(`     - Fits: ${Array.isArray(pipelineInfo.constraintsExtracted.fits) ? pipelineInfo.constraintsExtracted.fits.join(', ') : pipelineInfo.constraintsExtracted.fits}`);
    }
    if (pipelineInfo.constraintsExtracted.materials) {
      console.log(`     - Materials: ${Array.isArray(pipelineInfo.constraintsExtracted.materials) ? pipelineInfo.constraintsExtracted.materials.join(', ') : pipelineInfo.constraintsExtracted.materials}`);
    }
  }
  
  // Pipeline Execution
  console.log(`\n⚙️  Pipeline Execution:`);
  console.log(`   Gender Filter Applied: ${pipelineInfo.genderFilterApplied ? '✅' : '❌'}`);
  console.log(`   Retrieval Path: ${pipelineInfo.retrievalPath || 'unknown'}`);
  
  // Results
  console.log(`\n📦 Results:`);
  console.log(`   Products Returned: ${products.length}`);
  
  if (products.length > 0) {
    console.log(`   Sample Products:`);
    products.slice(0, 5).forEach((p: any, i: number) => {
      const title = p.title || 'N/A';
      const price = p.price ? `$${(p.price / 100).toFixed(2)}` : 'N/A';
      console.log(`     ${i + 1}. ${title} (${price})`);
    });
    
    // Check for wrong gender
    if (testCase.expectedGender || pipelineInfo.genderExtraction) {
      const expectedGender = testCase.expectedGender || pipelineInfo.genderExtraction;
      const wrongGenderProducts = products.filter((p: any) => {
        const title = (p.title || '').toLowerCase();
        if (expectedGender === 'female') {
          return title.includes("men's") || title.includes("mens-") || title.includes(" mens ");
        } else if (expectedGender === 'male') {
          return title.includes("women's") || title.includes("womens-") || title.includes(" womens ");
        }
        return false;
      });
      
      if (wrongGenderProducts.length > 0) {
        console.log(`\n   ❌ WRONG GENDER DETECTED: ${wrongGenderProducts.length} products`);
        wrongGenderProducts.forEach((p: any) => {
          console.log(`      - ${p.title}`);
        });
      } else {
        console.log(`\n   ✅ Gender Filter: Working correctly`);
      }
    }
    
    // Check if results match query intent
    const queryLower = testCase.query.toLowerCase();
    let matchesIntent = true;
    const issues: string[] = [];
    
    if (queryLower.includes('curvy') || queryLower.includes('mom')) {
      // Should return flattering, comfortable pieces
      const hasAppropriateProducts = products.some((p: any) => {
        const title = (p.title || '').toLowerCase();
        return title.includes('dress') || title.includes('top') || title.includes('pant');
      });
      if (!hasAppropriateProducts) {
        matchesIntent = false;
        issues.push('No appropriate products for curvy mom');
      }
    }
    
    if (queryLower.includes('bahamas') || queryLower.includes('vacation')) {
      // Should return lightweight, vacation-appropriate dresses
      const hasVacationDresses = products.some((p: any) => {
        const title = (p.title || '').toLowerCase();
        return title.includes('dress') && (title.includes('maxi') || title.includes('silk') || title.includes('chiffon'));
      });
      if (!hasVacationDresses) {
        matchesIntent = false;
        issues.push('No vacation-appropriate dresses');
      }
    }
    
    if (queryLower.includes('black tie') || queryLower.includes('wedding')) {
      // Should return formal/evening dresses
      const hasFormalDresses = products.some((p: any) => {
        const title = (p.title || '').toLowerCase();
        return title.includes('dress') && (title.includes('maxi') || title.includes('silk') || title.includes('lace'));
      });
      if (!hasFormalDresses) {
        matchesIntent = false;
        issues.push('No formal/evening dresses');
      }
    }
    
    if (queryLower.includes('elegant') || queryLower.includes('flowy')) {
      // Should return elegant, flowy dresses
      const hasElegantDresses = products.some((p: any) => {
        const title = (p.title || '').toLowerCase();
        return title.includes('dress') && (title.includes('maxi') || title.includes('silk') || title.includes('chiffon'));
      });
      if (!hasElegantDresses) {
        matchesIntent = false;
        issues.push('No elegant/flowy dresses');
      }
    }
    
    if (matchesIntent && issues.length === 0) {
      console.log(`\n   ✅ Results Match Query Intent`);
    } else {
      console.log(`\n   ⚠️  Results May Not Fully Match Intent:`);
      issues.forEach(issue => console.log(`      - ${issue}`));
    }
  } else {
    console.log(`\n   ⚠️  WARNING: No products returned`);
  }
  
  console.log(`${'='.repeat(100)}\n`);
}

async function main() {
  console.log('🚀 Diverse Prompts Test Suite');
  console.log(`Testing ${TEST_CASES.length} diverse prompts with detailed pipeline analysis\n`);
  
  const results: any[] = [];
  
  for (const testCase of TEST_CASES) {
    try {
      console.log(`\n⏳ Testing: "${testCase.query}"...`);
      
      // Run query
      const apiResults = await testQuery(testCase);
      
      // Wait for logs
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Extract logs
      const logs = await extractLogs(testCase);
      const pipelineInfo = analyzePipelineDetails(logs, testCase);
      
      // Analyze
      await analyzeResults(apiResults, testCase, pipelineInfo);
      
      results.push({
        testCase,
        apiResults,
        pipelineInfo,
      });
      
      // Delay between tests
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`❌ Failed to test "${testCase.query}":`, error);
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(100)}`);
  console.log('📊 TEST SUMMARY');
  console.log(`${'='.repeat(100)}\n`);
  
  results.forEach((result, i) => {
    const { testCase, pipelineInfo } = result;
    const products = result.apiResults.productCards || [];
    const wrongGender = testCase.expectedGender && pipelineInfo.genderExtraction === testCase.expectedGender
      ? products.filter((p: any) => {
          const title = (p.title || '').toLowerCase();
          if (testCase.expectedGender === 'female') {
            return title.includes("men's") || title.includes("mens-");
          } else if (testCase.expectedGender === 'male') {
            return title.includes("women's") || title.includes("womens-");
          }
          return false;
        }).length
      : 0;
    
    const status = products.length > 0 && wrongGender === 0 ? '✅ PASS' : 
                   products.length === 0 ? '⚠️  NO RESULTS' : '❌ FAIL';
    
    console.log(`${i + 1}. "${testCase.query}"`);
    console.log(`   Type: ${testCase.type}`);
    console.log(`   Gender: ${pipelineInfo.genderExtraction || 'null'} (expected: ${testCase.expectedGender || 'any'})`);
    console.log(`   Categories: ${pipelineInfo.categoryClassification?.join(', ') || 'none'}`);
    console.log(`   Products: ${products.length} | Wrong Gender: ${wrongGender}`);
    console.log(`   Status: ${status}`);
    console.log('');
  });
  
  console.log(`${'='.repeat(100)}\n`);
}

main().catch(console.error);
