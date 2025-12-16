// Analysis of timing data from the logs

const searches = [
  {
    name: "Search 1 (cache miss - cold start)",
    classifyDuration: 1842,
    retrievalDuration: 36800,
    retrievalBreakdown: {
      semanticDuration: 2701,
      conceptIndexDuration: 36796, // cache miss - building index
      conceptSearchDuration: 2,
    },
    loadDuration: 8943,
    rankingDuration: 3,
    replyDuration: 3861,
    totalTime: 55179,
  },
  {
    name: "Search 2 (cache miss - expired)",
    classifyDuration: 1583,
    retrievalDuration: 6397,
    retrievalBreakdown: {
      semanticDuration: 1497,
      conceptIndexDuration: 6391, // cache miss - building index
      conceptSearchDuration: 2,
    },
    loadDuration: 12351,
    rankingDuration: 8,
    replyDuration: 3205,
    totalTime: 26220,
  },
  {
    name: "Search 3 (cache hit)",
    classifyDuration: 1638,
    retrievalDuration: 1686,
    retrievalBreakdown: {
      semanticDuration: 1683,
      conceptIndexDuration: 1, // cache hit!
      conceptSearchDuration: 4,
    },
    loadDuration: 18608,
    rankingDuration: 6,
    replyDuration: 3823,
    totalTime: 27674,
  },
];

console.log("=".repeat(80));
console.log("TIMING ANALYSIS - Average Breakdown by Step\n");

// Calculate averages
const avgClassify = searches.reduce((sum, s) => sum + s.classifyDuration, 0) / searches.length;
const avgRetrieval = searches.reduce((sum, s) => sum + s.retrievalDuration, 0) / searches.length;
const avgLoad = searches.reduce((sum, s) => sum + s.loadDuration, 0) / searches.length;
const avgRanking = searches.reduce((sum, s) => sum + s.rankingDuration, 0) / searches.length;
const avgReply = searches.reduce((sum, s) => sum + s.replyDuration, 0) / searches.length;
const avgTotal = searches.reduce((sum, s) => sum + s.totalTime, 0) / searches.length;

// Cache hit vs miss
const cacheMiss = searches.filter(s => s.name.includes("cache miss"));
const cacheHit = searches.filter(s => s.name.includes("cache hit"));

const avgRetrievalCacheMiss = cacheMiss.reduce((sum, s) => sum + s.retrievalDuration, 0) / cacheMiss.length;
const avgRetrievalCacheHit = cacheHit[0].retrievalDuration;

// Detailed retrieval breakdown
const avgSemantic = searches.reduce((sum, s) => sum + s.retrievalBreakdown.semanticDuration, 0) / searches.length;
const avgConceptIndex = searches.reduce((sum, s) => sum + s.retrievalBreakdown.conceptIndexDuration, 0) / searches.length;
const avgConceptSearch = searches.reduce((sum, s) => sum + s.retrievalBreakdown.conceptSearchDuration, 0) / searches.length;

console.log("OVERALL AVERAGES (across all searches):");
console.log("-".repeat(80));
console.log(`1. Classification:      ${avgClassify.toFixed(0)}ms (${(avgClassify/1000).toFixed(1)}s) - ${((avgClassify/avgTotal)*100).toFixed(1)}%`);
console.log(`2. Retrieval:           ${avgRetrieval.toFixed(0)}ms (${(avgRetrieval/1000).toFixed(1)}s) - ${((avgRetrieval/avgTotal)*100).toFixed(1)}%`);
console.log(`   - Semantic search:   ${avgSemantic.toFixed(0)}ms (${(avgSemantic/1000).toFixed(1)}s)`);
console.log(`   - Concept index:     ${avgConceptIndex.toFixed(0)}ms (${(avgConceptIndex/1000).toFixed(1)}s)`);
console.log(`   - Concept search:    ${avgConceptSearch.toFixed(0)}ms`);
console.log(`3. Load products:       ${avgLoad.toFixed(0)}ms (${(avgLoad/1000).toFixed(1)}s) - ${((avgLoad/avgTotal)*100).toFixed(1)}%`);
console.log(`4. Ranking:             ${avgRanking.toFixed(0)}ms - ${((avgRanking/avgTotal)*100).toFixed(1)}%`);
console.log(`5. Reply generation:    ${avgReply.toFixed(0)}ms (${(avgReply/1000).toFixed(1)}s) - ${((avgReply/avgTotal)*100).toFixed(1)}%`);
console.log(`\nTOTAL:                  ${avgTotal.toFixed(0)}ms (${(avgTotal/1000).toFixed(1)}s)`);

console.log("\n" + "=".repeat(80));
console.log("RETRIEVAL BREAKDOWN - Cache Hit vs Miss:\n");
console.log(`Cache MISS average:  ${avgRetrievalCacheMiss.toFixed(0)}ms (${(avgRetrievalCacheMiss/1000).toFixed(1)}s)`);
console.log(`Cache HIT:           ${avgRetrievalCacheHit.toFixed(0)}ms (${(avgRetrievalCacheHit/1000).toFixed(1)}s)`);
console.log(`\nImprovement with cache: ${((avgRetrievalCacheMiss - avgRetrievalCacheHit) / avgRetrievalCacheMiss * 100).toFixed(1)}% faster`);

console.log("\n" + "=".repeat(80));
console.log("BOTTLENECK ANALYSIS:\n");

const steps = [
  { name: "Load products", time: avgLoad, percentage: (avgLoad/avgTotal)*100 },
  { name: "Retrieval (avg)", time: avgRetrieval, percentage: (avgRetrieval/avgTotal)*100 },
  { name: "Reply generation", time: avgReply, percentage: (avgReply/avgTotal)*100 },
  { name: "Classification", time: avgClassify, percentage: (avgClassify/avgTotal)*100 },
  { name: "Ranking", time: avgRanking, percentage: (avgRanking/avgTotal)*100 },
];

steps.sort((a, b) => b.time - a.time);

steps.forEach((step, idx) => {
  const bar = "█".repeat(Math.round(step.percentage / 2));
  console.log(`${idx + 1}. ${step.name.padEnd(25)} ${step.time.toFixed(0)}ms (${(step.time/1000).toFixed(1)}s) ${step.percentage.toFixed(1)}% ${bar}`);
});

console.log("\n" + "=".repeat(80));
console.log("RECOMMENDATION:");
console.log("The biggest bottleneck is PRODUCT LOADING (~13.3s avg, 36.6% of total time)");
console.log("This is expected as we load full product data with large JSON attributes.");
console.log("Consider: reducing products loaded (currently 75, only need ~20-30 for top results)");
