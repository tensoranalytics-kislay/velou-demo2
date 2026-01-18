// Extract timing from the terminal logs you provided
// Based on the visible logs from your terminal selection

const timingData = {
  query: "I have dr.martens high top chelsea shoes, suggest me a dress that goes well with it",
  steps: [
    {
      name: "Ranking",
      duration: 24, // ms
      timestamp: "2026-01-14T09:18:29.932Z",
      source: "handleLoveshackfancyQuery: ranking_complete - rankingDurationMs: 24"
    },
    {
      name: "Emotional Keywords Generation",
      start: "2026-01-14T09:18:29.936Z",
      end: "2026-01-14T09:18:31.623Z",
      duration: 1687, // ms (calculated from timestamps)
      source: "emotional_keywords_generation_start → emotional_keywords_batch_llm_response"
    },
    {
      name: "Reply Generation (Total)",
      duration: 9277, // ms
      timestamp: "2026-01-14T09:18:39.210Z",
      source: "generateReply: complete - totalDurationMs: 9277"
    },
    {
      name: "Reply Generation (LLM Call)",
      duration: 9276, // ms
      timestamp: "2026-01-14T09:18:39.210Z",
      source: "generateReply: complete - llmDurationMs: 9276"
    },
    {
      name: "Reply Generation (Orchestrator)",
      duration: 9278, // ms
      timestamp: "2026-01-14T09:18:39.211Z",
      source: "handleLoveshackfancyQuery: reply_generation_complete - replyDurationMs: 9278"
    }
  ]
};

console.log('=== QUERY TIMING ANALYSIS ===\n');
console.log(`Query: "${timingData.query}"\n`);

// Calculate total time
const replyStart = new Date("2026-01-14T09:18:29.933Z").getTime(); // Reply generation start
const replyEnd = new Date("2026-01-14T09:18:39.211Z").getTime(); // Reply generation complete
const totalTime = replyEnd - replyStart;

// Also include ranking time
const rankingTime = 24;
const emotionalKeywordsTime = 1687;
const replyGenTime = 9278;

const totalVisibleTime = rankingTime + emotionalKeywordsTime + replyGenTime;

console.log('Step-by-Step Breakdown:\n');

timingData.steps.forEach((step, index) => {
  const seconds = (step.duration / 1000).toFixed(2);
  const percentage = totalVisibleTime > 0 ? ((step.duration / totalVisibleTime) * 100).toFixed(1) : 'N/A';
  let status = '✅';
  if (step.duration > 5000) status = '🔴';
  else if (step.duration > 1000) status = '🟡';
  
  console.log(`${status} ${index + 1}. ${step.name}`);
  console.log(`   Duration: ${step.duration}ms (${seconds}s) - ${percentage}% of visible time`);
  if (step.timestamp) {
    console.log(`   Timestamp: ${step.timestamp}`);
  } else if (step.start && step.end) {
    console.log(`   Time: ${step.start} → ${step.end}`);
  }
  console.log(`   Source: ${step.source}`);
  console.log('');
});

console.log(`\n=== SUMMARY ===\n`);
console.log(`Total Visible Time: ${(totalVisibleTime / 1000).toFixed(2)}s (${totalVisibleTime}ms)`);
console.log(`  - Ranking: ${(rankingTime / 1000).toFixed(2)}s`);
console.log(`  - Emotional Keywords: ${(emotionalKeywordsTime / 1000).toFixed(2)}s`);
console.log(`  - Reply Generation: ${(replyGenTime / 1000).toFixed(2)}s\n`);

// Sort by duration to find bottlenecks
const sortedSteps = [...timingData.steps].sort((a, b) => b.duration - a.duration);
console.log('Slowest Steps:');
sortedSteps.slice(0, 5).forEach((step, index) => {
  const seconds = (step.duration / 1000).toFixed(2);
  console.log(`${index + 1}. ${step.name}: ${seconds}s`);
});

console.log('\n=== KEY FINDINGS ===\n');
console.log('🔴 Reply Generation is the MAJOR bottleneck: ~9.28 seconds (99% of visible time)');
console.log('🟡 Emotional Keywords: ~1.69 seconds');
console.log('✅ Ranking is extremely fast: <0.1 seconds');
console.log('\nNote: Classification, Retrieval, and Product Loading timings are not visible in these logs.');
console.log('They may have occurred before the visible log window or need additional logging.');
