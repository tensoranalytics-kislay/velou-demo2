/**
 * Test script to verify the new pipeline works correctly
 * Tests all steps are linked and execute in the correct order
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const LOG_FILE = join(process.cwd(), 'app.log');

interface TestQuery {
  query: string;
  description: string;
  expectedSteps: string[];
  expectedGender?: 'male' | 'female' | null;
  expectedAgeGroup?: string | null;
  expectedCategory?: string;
}

const TEST_QUERIES: TestQuery[] = [
  {
    query: "Show me high-rise skinny jeans for women in dark colors",
    description: "Gender-specific query with multiple constraints",
    expectedSteps: [
      'gender_and_agegroup_extracted_early',
      'categories_filtered_before_classification',
      'category_classification_complete_with_confidence',
      'categories_filtered_by_gender_after_classification',
      'dictionary_refinement_starting_before_retrieval',
      'dictionary_refinement_complete_before_retrieval',
      'handleLoveshackfancyQuery: starting_retrieval',
      'handleLoveshackfancyQuery: retrieval_complete',
    ],
    expectedGender: 'female',
    expectedAgeGroup: 'Adult',
    expectedCategory: 'jeans',
  },
  {
    query: "Find me men's dress shirts",
    description: "Simple male query",
    expectedSteps: [
      'gender_and_agegroup_extracted_early',
      'categories_filtered_before_classification',
      'dictionary_refinement_starting_before_retrieval',
      'handleLoveshackfancyQuery: starting_retrieval',
    ],
    expectedGender: 'male',
    expectedAgeGroup: 'Adult',
  },
  {
    query: "I need a black dress for a wedding",
    description: "Occasion-based query (defaults to female)",
    expectedSteps: [
      'gender_and_agegroup_extracted_early',
      'categories_filtered_before_classification',
      'dictionary_refinement_starting_before_retrieval',
      'handleLoveshackfancyQuery: starting_retrieval',
    ],
    expectedAgeGroup: 'Adult',
  },
  {
    query: "Show me summer dresses for kids",
    description: "Age group query",
    expectedSteps: [
      'gender_and_agegroup_extracted_early',
      'categories_filtered_before_classification',
      'dictionary_refinement_starting_before_retrieval',
      'handleLoveshackfancyQuery: starting_retrieval',
    ],
    expectedAgeGroup: 'Kids',
  },
  {
    query: "High-rise skinny jeans for women in dark colors, preferably vintage wash",
    description: "Complex query with multiple constraints",
    expectedSteps: [
      'gender_and_agegroup_extracted_early',
      'categories_filtered_before_classification',
      'dictionary_refinement_starting_before_retrieval',
      'handleLoveshackfancyQuery: starting_retrieval',
    ],
    expectedGender: 'female',
  },
];

function readLogFile(): string {
  try {
    return readFileSync(LOG_FILE, 'utf-8');
  } catch (error) {
    console.error('Error reading log file:', error);
    return '';
  }
}

function extractLogLines(logContent: string, query: string): string[] {
  // Extract log lines related to this query
  const lines = logContent.split('\n');
  const queryStart = query.substring(0, 50).toLowerCase();
  const relevantLines: string[] = [];
  let inQuery = false;
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes(queryStart) || lowerLine.includes('gender_and_agegroup_extracted_early')) {
      inQuery = true;
    }
    if (inQuery && (line.includes('INFO') || line.includes('DEBUG'))) {
      relevantLines.push(line);
      // Stop after retrieval complete
      if (line.includes('retrieval_complete') || line.includes('ranking_complete')) {
        break;
      }
    }
  }
  
  return relevantLines;
}

function checkStepExists(logLines: string[], step: string): boolean {
  return logLines.some(line => line.includes(step));
}

function extractValue(logLines: string[], key: string): string | null {
  for (const line of logLines) {
    const match = new RegExp(`"${key}":\\s*"([^"]+)"`).exec(line);
    if (match) return match[1];
    const match2 = new RegExp(`"${key}":\\s*([^,}\\s]+)`).exec(line);
    if (match2) return match2[1];
  }
  return null;
}

async function testQuery(testQuery: TestQuery): Promise<{
  passed: boolean;
  issues: string[];
  logLines: string[];
}> {
  console.log(`\n🧪 Testing: ${testQuery.description}`);
  console.log(`   Query: "${testQuery.query}"`);
  
  const issues: string[] = [];
  
  // Clear log file or get current position
  const logBefore = readLogFile();
  const logBeforeLines = logBefore.split('\n').length;
  
  // Make API call
  try {
    const response = await fetch(`${API_URL}/api/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: `test-${Date.now()}`,
        message: testQuery.query,
        merchantId: process.env.MERCHANT_ID || 'loveshackfancy',
      }),
    });
    
    if (!response.ok) {
      issues.push(`API call failed: ${response.status} ${response.statusText}`);
      return { passed: false, issues, logLines: [] };
    }
    
    const result = await response.json();
    console.log(`   ✅ API call successful`);
    console.log(`   Products returned: ${result.productCards?.length || 0}`);
    
    // Wait a bit for logs to be written
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Read logs
    const logAfter = readLogFile();
    const logLines = logAfter.split('\n').slice(logBeforeLines);
    const relevantLogLines = extractLogLines(logLines.join('\n'), testQuery.query);
    
    // Check expected steps
    console.log(`   Checking pipeline steps...`);
    for (const step of testQuery.expectedSteps) {
      const exists = checkStepExists(relevantLogLines, step);
      if (exists) {
        console.log(`   ✅ Step found: ${step}`);
      } else {
        console.log(`   ❌ Step missing: ${step}`);
        issues.push(`Missing step: ${step}`);
      }
    }
    
    // Check gender extraction
    if (testQuery.expectedGender !== undefined) {
      const extractedGender = extractValue(relevantLogLines, 'resolvedGender');
      if (extractedGender === testQuery.expectedGender || 
          (testQuery.expectedGender === null && extractedGender === 'null')) {
        console.log(`   ✅ Gender correct: ${extractedGender}`);
      } else {
        console.log(`   ❌ Gender mismatch: expected ${testQuery.expectedGender}, got ${extractedGender}`);
        issues.push(`Gender mismatch: expected ${testQuery.expectedGender}, got ${extractedGender}`);
      }
    }
    
    // Check age group extraction
    if (testQuery.expectedAgeGroup !== undefined) {
      const extractedAgeGroup = extractValue(relevantLogLines, 'resolvedAgeGroup');
      if (extractedAgeGroup === testQuery.expectedAgeGroup) {
        console.log(`   ✅ AgeGroup correct: ${extractedAgeGroup}`);
      } else {
        console.log(`   ❌ AgeGroup mismatch: expected ${testQuery.expectedAgeGroup}, got ${extractedAgeGroup}`);
        issues.push(`AgeGroup mismatch: expected ${testQuery.expectedAgeGroup}, got ${extractedAgeGroup}`);
      }
    }
    
    // Check product quality (basic)
    if (result.productCards && result.productCards.length > 0) {
      const firstProduct = result.productCards[0];
      if (testQuery.expectedGender && testQuery.expectedGender === 'female') {
        const title = firstProduct.title?.toLowerCase() || '';
        if (title.includes("men's") || title.includes("mens")) {
          issues.push(`Wrong gender products returned: found men's product for female query`);
          console.log(`   ❌ Wrong gender products returned`);
        } else {
          console.log(`   ✅ Products appear to match gender`);
        }
      }
    } else {
      console.log(`   ⚠️  No products returned`);
    }
    
    return {
      passed: issues.length === 0,
      issues,
      logLines: relevantLogLines,
    };
    
  } catch (error) {
    issues.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return { passed: false, issues, logLines: [] };
  }
}

async function runTests() {
  console.log('🚀 Starting Pipeline Tests');
  console.log('=' .repeat(60));
  console.log(`API URL: ${API_URL}`);
  console.log(`Log file: ${LOG_FILE}`);
  
  // Check if server is running
  try {
    const healthCheck = await fetch(`${API_URL}/api/health`);
    if (!healthCheck.ok) {
      console.error('❌ Server health check failed. Is the server running?');
      process.exit(1);
    }
    console.log('✅ Server is running');
  } catch (error) {
    console.error('❌ Cannot connect to server. Is it running?');
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  
  const results: Array<{ test: TestQuery; result: { passed: boolean; issues: string[] } }> = [];
  
  // Run each test
  for (const testQuery of TEST_QUERIES) {
    const result = await testQuery(testQuery);
    results.push({ test: testQuery, result });
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.result.passed).length;
  const failed = results.filter(r => !r.result.passed).length;
  
  console.log(`Total tests: ${results.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.forEach(({ test, result }) => {
      if (!result.passed) {
        console.log(`\n  "${test.query}"`);
        console.log(`  Issues:`);
        result.issues.forEach(issue => console.log(`    - ${issue}`));
      }
    });
  }
  
  // Check pipeline order
  console.log('\n' + '='.repeat(60));
  console.log('🔗 Pipeline Step Order Verification');
  console.log('='.repeat(60));
  
  const allLogs = readLogFile();
  const stepOrder = [
    'gender_and_agegroup_extracted_early',
    'categories_filtered_before_classification',
    'category_classification_complete_with_confidence',
    'categories_filtered_by_gender_after_classification',
    'dictionary_refinement_starting_before_retrieval',
    'dictionary_refinement_complete_before_retrieval',
    'handleLoveshackfancyQuery: starting_retrieval',
    'handleLoveshackfancyQuery: retrieval_complete',
  ];
  
  const stepPositions: number[] = [];
  for (const step of stepOrder) {
    const index = allLogs.indexOf(step);
    if (index !== -1) {
      stepPositions.push(index);
      console.log(`✅ Found: ${step}`);
    } else {
      console.log(`❌ Missing: ${step}`);
    }
  }
  
  // Check if steps are in correct order
  let orderCorrect = true;
  for (let i = 1; i < stepPositions.length; i++) {
    if (stepPositions[i] < stepPositions[i - 1]) {
      orderCorrect = false;
      console.log(`❌ Step order incorrect: ${stepOrder[i]} appears before ${stepOrder[i - 1]}`);
    }
  }
  
  if (orderCorrect && stepPositions.length === stepOrder.length) {
    console.log('\n✅ All pipeline steps are in correct order!');
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
