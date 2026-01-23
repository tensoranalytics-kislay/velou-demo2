import { readFileSync } from 'fs';

const logFile = 'pipeline-debug-output.log';
const content = readFileSync(logFile, 'utf-8');

// Extract test sections
const test1Match = content.match(/TEST 1: Office Dress Query[\s\S]*?(?=TEST 2:|$)/);
const test2Match = content.match(/TEST 2: Simple Dress Query[\s\S]*?(?=TEST 3:|$)/);
const test3Match = content.match(/TEST 3: Pastel Tops Query[\s\S]*?$/);

function analyzeTest(testName: string, content: string | null) {
  if (!content) {
    console.log(`\n${testName}: NOT FOUND`);
    return;
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`${testName}:`);
  console.log('='.repeat(80));
  
  // Check for errors
  const errors = content.match(/❌ Error:|ERROR|Error:/g);
  if (errors) {
    console.log(`❌ ERRORS FOUND: ${errors.length}`);
    const errorDetails = content.match(/❌ Error:[\s\S]*?(?=\n\n|\n\[|$)/);
    if (errorDetails) {
      console.log(errorDetails[0].substring(0, 500));
    }
  }
  
  // Check pipeline stages
  const stages = {
    'Pre-deduplication': content.match(/deduplicateProductsByCategoryForPostFiltering.*results found.*count: (\d+)/),
    'Vector Search': content.match(/searchVectorIndexWithDeduplication.*results found.*resultCount: (\d+)/),
    'Semantic Search': content.match(/fashion_semantic_search.*tier1_success.*resultCount: (\d+)/),
    'Ranking': content.match(/constraint_based_ranking_applied/),
    'Final Products': content.match(/Products Returned: (\d+)/),
  };
  
  console.log('\n📊 PIPELINE STAGES:');
  for (const [stage, match] of Object.entries(stages)) {
    if (match) {
      if (typeof match === 'boolean') {
        console.log(`  ✅ ${stage}: PASSED`);
      } else {
        console.log(`  ✅ ${stage}: ${match[1]} products`);
      }
    } else {
      console.log(`  ❌ ${stage}: NOT FOUND or FAILED`);
    }
  }
  
  // Check scores
  const topScore = content.match(/topScore: ([\d.]+)/);
  const avgScore = content.match(/avgScore: ([\d.]+)/);
  const scoreRange = content.match(/scoreRange: '([^']+)'/);
  
  if (topScore || avgScore || scoreRange) {
    console.log('\n📈 SCORING:');
    if (topScore) console.log(`  Top Score: ${topScore[1]}`);
    if (avgScore) console.log(`  Avg Score: ${avgScore[1]}`);
    if (scoreRange) console.log(`  Score Range: ${scoreRange[1]}`);
  }
  
  // Check filtering
  const filtered = content.match(/products_filtered_by_relevance_score.*beforeFilterCount: (\d+).*afterFilterCount: (\d+)/);
  if (filtered) {
    console.log('\n🔍 FILTERING:');
    console.log(`  Before Filter: ${filtered[1]} products`);
    console.log(`  After Filter: ${filtered[2]} products`);
    console.log(`  Filtered Out: ${parseInt(filtered[1]) - parseInt(filtered[2])} products`);
  }
  
  // Check constraints
  const constraints = content.match(/classifier_constraint_extraction[\s\S]*?colors:.*?intent: '(\w+)'/);
  if (constraints) {
    console.log('\n🎯 CONSTRAINTS:');
    console.log(`  Colors Intent: ${constraints[1]}`);
  }
}

analyzeTest('TEST 1: Office Dress Query', test1Match?.[0] || null);
analyzeTest('TEST 2: Simple Dress Query', test2Match?.[0] || null);
analyzeTest('TEST 3: Pastel Tops Query', test3Match?.[0] || null);
