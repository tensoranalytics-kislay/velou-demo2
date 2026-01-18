#!/usr/bin/env tsx

/**
 * Comprehensive Pipeline Test
 * Tests 5 varied prompts with direct/indirect gender specification
 */

interface TestCase {
  id: string;
  query: string;
  description: string;
  type: 'direct-gender' | 'indirect-gender' | 'occasion-based' | 'context-based';
  expectedGender?: 'male' | 'female';
  expectedProductType?: string;
}

const TEST_CASES: TestCase[] = [
  {
    id: 'test-1',
    query: "Show me jeans for women",
    description: "Direct gender specification with product type",
    type: 'direct-gender',
    expectedGender: 'female',
    expectedProductType: 'jeans',
  },
  {
    id: 'test-2',
    query: "I need a dress shirt for a business meeting",
    description: "Occasion-based query (business meeting implies formal men's wear)",
    type: 'occasion-based',
    expectedGender: 'male',
    expectedProductType: 'shirt',
  },
  {
    id: 'test-3',
    query: "What should I wear to a beach wedding?",
    description: "Occasion-based query (beach wedding - typically dress, implies female)",
    type: 'occasion-based',
    expectedGender: 'female',
    expectedProductType: 'dress',
  },
  {
    id: 'test-4',
    query: "I want high-rise skinny jeans in dark colors",
    description: "Indirect gender via style indicators (high-rise skinny = female)",
    type: 'indirect-gender',
    expectedGender: 'female',
    expectedProductType: 'jeans',
  },
  {
    id: 'test-5',
    query: "Looking for comfortable loungewear for working from home",
    description: "Context-based query (gender-neutral but should infer from context or default)",
    type: 'context-based',
    expectedGender: undefined, // May infer from context or default
    expectedProductType: 'loungewear',
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

async function checkLogs(testCase: TestCase): Promise<any> {
  // Read logs to check pipeline stages
  const { execSync } = require('child_process');
  try {
    const logs = execSync(
      `tail -2000 app.log 2>/dev/null | grep -E "${testCase.id}.*${testCase.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" | head -100`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    return logs;
  } catch (error) {
    return '';
  }
}

function analyzePipelineStages(logs: string, testCase: TestCase): any {
  const stages = {
    genderExtraction: logs.includes('gender_and_agegroup_extracted_early'),
    categoryFiltering: logs.includes('categories_filtered_before_classification'),
    categoryClassification: logs.includes('category_classification_complete'),
    genderFilterApplied: logs.includes('gender_hard_filter_applied_to_retrieval'),
    retrievalStarted: logs.includes('starting_retrieval'),
    rankingStarted: logs.includes('orchestrator_constraint_ranking_start'),
    replyGenerated: logs.includes('assistant_query_complete'),
  };

  // Extract gender from logs
  const genderMatch = logs.match(/resolvedGender["\s:]+"?(female|male)"?/);
  const extractedGender = genderMatch ? genderMatch[1] : null;

  // Extract categories from logs
  const categoryMatch = logs.match(/categories["\s:]+\["([^"]+)"/);
  const extractedCategories = categoryMatch ? [categoryMatch[1]] : [];

  return {
    stages,
    extractedGender,
    extractedCategories,
  };
}

async function analyzeResults(results: any, testCase: TestCase, pipelineInfo: any): Promise<void> {
  const products = results.productCards || [];
  const productTitles = products.map((p: any) => p.title || '').join(', ');
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📋 Test: ${testCase.id} - ${testCase.description}`);
  console.log(`   Query: "${testCase.query}"`);
  console.log(`   Type: ${testCase.type}`);
  console.log(`${'='.repeat(80)}`);
  
  // Pipeline Stages
  console.log(`\n🔍 Pipeline Stages:`);
  console.log(`   ✅ Gender Extraction: ${pipelineInfo.stages.genderExtraction ? '✓' : '✗'}`);
  console.log(`   ✅ Category Filtering: ${pipelineInfo.stages.categoryFiltering ? '✓' : '✗'}`);
  console.log(`   ✅ Category Classification: ${pipelineInfo.stages.categoryClassification ? '✓' : '✗'}`);
  console.log(`   ✅ Gender Filter Applied: ${pipelineInfo.stages.genderFilterApplied ? '✓' : '✗'}`);
  console.log(`   ✅ Retrieval Started: ${pipelineInfo.stages.retrievalStarted ? '✓' : '✗'}`);
  console.log(`   ✅ Ranking Started: ${pipelineInfo.stages.rankingStarted ? '✓' : '✗'}`);
  console.log(`   ✅ Reply Generated: ${pipelineInfo.stages.replyGenerated ? '✓' : '✗'}`);
  
  // Extracted Values
  console.log(`\n📊 Extracted Values:`);
  console.log(`   Gender Extracted: ${pipelineInfo.extractedGender || 'null'}`);
  if (testCase.expectedGender) {
    const genderMatch = pipelineInfo.extractedGender === testCase.expectedGender;
    console.log(`   Expected Gender: ${testCase.expectedGender} ${genderMatch ? '✅' : '❌'}`);
  }
  console.log(`   Categories Extracted: ${pipelineInfo.extractedCategories.join(', ') || 'none'}`);
  
  // Results
  console.log(`\n📦 Results:`);
  console.log(`   Products Returned: ${products.length}`);
  
  if (products.length > 0) {
    console.log(`   Sample Products:`);
    products.slice(0, 5).forEach((p: any, i: number) => {
      console.log(`     ${i + 1}. ${p.title || 'N/A'}`);
    });
    
    // Check for wrong gender products
    if (testCase.expectedGender || pipelineInfo.extractedGender) {
      const expectedGender = testCase.expectedGender || pipelineInfo.extractedGender;
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
        console.log(`\n   ❌ WRONG GENDER DETECTED: ${wrongGenderProducts.length} products with wrong gender`);
        wrongGenderProducts.forEach((p: any) => {
          console.log(`      - ${p.title}`);
        });
      } else {
        console.log(`\n   ✅ Gender Filter: Working correctly (no wrong-gender products)`);
      }
    }
  } else {
    if (testCase.expectedProductType) {
      console.log(`   ⚠️  WARNING: Expected results but got 0 products`);
    } else {
      console.log(`   ℹ️  No products returned`);
    }
  }
  
  console.log(`${'='.repeat(80)}\n`);
}

async function main() {
  console.log('🚀 Comprehensive Pipeline Test Suite');
  console.log(`Testing ${TEST_CASES.length} varied prompts\n`);
  
  const results: any[] = [];
  
  for (const testCase of TEST_CASES) {
    try {
      console.log(`\n⏳ Testing: "${testCase.query}"...`);
      
      // Run query
      const apiResults = await testQuery(testCase);
      
      // Wait a bit for logs to be written
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check logs
      const logs = await checkLogs(testCase);
      const pipelineInfo = analyzePipelineStages(logs, testCase);
      
      // Analyze
      await analyzeResults(apiResults, testCase, pipelineInfo);
      
      results.push({
        testCase,
        apiResults,
        pipelineInfo,
      });
      
      // Delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ Failed to test "${testCase.query}":`, error);
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 TEST SUMMARY');
  console.log(`${'='.repeat(80)}\n`);
  
  results.forEach((result, i) => {
    const { testCase, pipelineInfo } = result;
    const products = result.apiResults.productCards || [];
    const wrongGender = testCase.expectedGender && pipelineInfo.extractedGender === testCase.expectedGender
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
    console.log(`   Gender Extracted: ${pipelineInfo.extractedGender || 'null'}`);
    console.log(`   Products: ${products.length} | Wrong Gender: ${wrongGender}`);
    console.log(`   Status: ${status}`);
    console.log('');
  });
  
  console.log(`${'='.repeat(80)}\n`);
}

main().catch(console.error);
