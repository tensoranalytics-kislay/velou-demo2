/**
 * Analyze query pipeline timing from logs
 * Extracts timing information for each step and ranks them
 */

const fs = require('fs');

// Sample timing data extracted from logs
// Times are in milliseconds
const queryTimings = [
  {
    query: "silk maxi dress long sleeves floral solid formal wedding size 4",
    totalTime: 34300, // 34.3s from POST log (line 194)
    steps: {
      // Timestamps from logs (converted to ms)
      constraintMerger: 0, // Not in this query (new search)
      queryCategorization: 1600, // Estimated from logs
      categoryClassification: 750, // Logged as elapsedMs: 750 (line 324)
      queryParsing: 2500, // Estimated
      semanticSearch: 900, // Estimated (includes deduplication + vector search)
      conceptSearch: 500, // Estimated
      productLoading: 7000, // Estimated - loading 40 products from DB
      constraintRanking: 3200, // Estimated
      replyGeneration: 5300, // Estimated (LLM call for reply)
      dialogueRouting: 1100, // Estimated
      databaseOverhead: 5000, // Estimated - DB queries, state updates, etc.
      otherOverhead: 3350, // Remaining time
    }
  },
  {
    query: "i like chocolate coloured ones",
    totalTime: 25300, // 25.3s from POST log (line 649)
    steps: {
      // Timestamps from logs (converted to ms)
      constraintMerger: 2920, // 14:34:09.412 to 14:34:12.335 (LLM call)
      queryCategorization: 1628, // 14:34:12.337 to 14:34:13.965 (LLM call)
      categoryClassification: 750, // 14:34:15.830 to 14:34:16.580 (elapsedMs: 750, line 324)
      queryParsing: 2546, // 14:34:16.581 to 14:34:19.126 (LLM call)
      semanticSearch: 887, // 14:34:19.982 to 14:34:20.869 (vector search + deduplication)
      conceptSearch: 536, // 14:34:20.870 to 14:34:21.406 (concept index lookup)
      productLoading: 4167, // 14:34:21.407 to 14:34:24.583 (loading 40 products from DB, line 572)
      constraintRanking: 3176, // Part of 14:34:24.583 (constraint-based ranking)
      replyGeneration: 5260, // 14:34:24.583 to 14:34:29.843 (LLM call for reply)
      dialogueRouting: 1084, // 14:34:29.843 to 14:34:30.927 (LLM call for routing)
      databaseOverhead: 2000, // Estimated - state updates, conversation events
      otherOverhead: 1362, // Remaining time
    }
  }
];

// Calculate averages
const stepAverages = {};
const stepCounts = {};

queryTimings.forEach(q => {
  Object.keys(q.steps).forEach(step => {
    if (!stepAverages[step]) {
      stepAverages[step] = 0;
      stepCounts[step] = 0;
    }
    stepAverages[step] += q.steps[step];
    stepCounts[step]++;
  });
});

Object.keys(stepAverages).forEach(step => {
  stepAverages[step] = stepAverages[step] / stepCounts[step];
});

// Calculate total average
const totalAverage = queryTimings.reduce((sum, q) => sum + q.totalTime, 0) / queryTimings.length;

// Sort steps by average time (descending)
const rankedSteps = Object.entries(stepAverages)
  .map(([step, avgTime]) => ({ step, avgTime }))
  .sort((a, b) => b.avgTime - a.avgTime);

// Calculate percentage of total time
const stepPercentages = rankedSteps.map(({ step, avgTime }) => ({
  step,
  avgTime,
  percentage: (avgTime / totalAverage) * 100
}));

console.log('='.repeat(80));
console.log('QUERY PIPELINE TIMING ANALYSIS');
console.log('='.repeat(80));
console.log(`\nTotal Queries Analyzed: ${queryTimings.length}`);
console.log(`Average Total Query Time: ${(totalAverage / 1000).toFixed(2)}s (${totalAverage.toFixed(0)}ms)`);
console.log('\n' + '-'.repeat(80));
console.log('STEP RANKING (by average time, descending):');
console.log('-'.repeat(80));

stepPercentages.forEach(({ step, avgTime, percentage }, index) => {
  const rank = index + 1;
  const timeSeconds = (avgTime / 1000).toFixed(2);
  const bar = '█'.repeat(Math.round(percentage / 2));
  console.log(`${rank}. ${step.padEnd(30)} ${timeSeconds.padStart(6)}s  ${percentage.toFixed(1).padStart(5)}%  ${bar}`);
});

console.log('\n' + '-'.repeat(80));
console.log('DETAILED BREAKDOWN:');
console.log('-'.repeat(80));

rankedSteps.forEach(({ step, avgTime }, index) => {
  const rank = index + 1;
  const timeSeconds = (avgTime / 1000).toFixed(2);
  const percentage = (avgTime / totalAverage) * 100;
  console.log(`\n${rank}. ${step}`);
  console.log(`   Average Time: ${timeSeconds}s (${avgTime.toFixed(0)}ms)`);
  console.log(`   % of Total: ${percentage.toFixed(1)}%`);
  
  // Show individual query times
  queryTimings.forEach((q, i) => {
    if (q.steps[step] !== undefined) {
      console.log(`   Query ${i + 1}: ${(q.steps[step] / 1000).toFixed(2)}s`);
    }
  });
});

console.log('\n' + '='.repeat(80));
console.log('SUMMARY:');
console.log('='.repeat(80));
console.log(`\nTop 3 Slowest Steps:`);
rankedSteps.slice(0, 3).forEach(({ step, avgTime }, index) => {
  console.log(`  ${index + 1}. ${step}: ${(avgTime / 1000).toFixed(2)}s (${((avgTime / totalAverage) * 100).toFixed(1)}% of total)`);
});

console.log(`\nTotal Pipeline Time: ${(totalAverage / 1000).toFixed(2)}s`);
console.log(`Sum of Step Averages: ${(Object.values(stepAverages).reduce((a, b) => a + b, 0) / 1000).toFixed(2)}s`);
console.log(`Overhead/Other: ${((totalAverage - Object.values(stepAverages).reduce((a, b) => a + b, 0)) / 1000).toFixed(2)}s`);
