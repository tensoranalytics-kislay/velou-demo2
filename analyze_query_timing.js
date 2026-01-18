/**
 * Analyze query timing from logs
 * Extracts timing information for each step in the search pipeline
 */

// From the logs provided, extract timestamps
const logTimings = {
  // Timestamps from the logs (ISO format)
  timestamps: [
    { event: 'fashion_multiview_retrieval_start', time: '2026-01-14T09:02:16.272Z' },
    { event: 'orchestrator_constraint_ranking_start', time: '2026-01-14T09:02:17.156Z' },
    { event: 'constraint_ranking_applied', time: '2026-01-14T09:02:17.181Z' },
    { event: 'emotional_keywords_generation_start', time: '2026-01-14T09:02:17.185Z' },
    { event: 'emotional_keywords_batch_llm_response', time: '2026-01-14T09:02:18.544Z' },
    { event: 'reply_split_result', time: '2026-01-14T09:02:24.101Z' },
    { event: 'assistant_query_complete', time: '2026-01-14T09:02:25.414Z' },
  ]
};

function parseTimestamp(isoString) {
  return new Date(isoString).getTime();
}

function calculateDurations(timestamps) {
  const parsed = timestamps.map(t => ({
    event: t.event,
    time: parseTimestamp(t.time)
  }));

  const durations = [];
  let prevTime = parsed[0].time;
  let prevEvent = 'query_start_estimated';

  for (let i = 0; i < parsed.length; i++) {
    const current = parsed[i];
    const duration = current.time - prevTime;
    
    durations.push({
      step: prevEvent + ' → ' + current.event,
      durationMs: duration,
      durationSeconds: (duration / 1000).toFixed(2)
    });

    prevTime = current.time;
    prevEvent = current.event;
  }

  return durations;
}

const durations = calculateDurations(logTimings.timestamps);
const totalTime = parseTimestamp(logTimings.timestamps[logTimings.timestamps.length - 1].time) - 
                  parseTimestamp(logTimings.timestamps[0].time);

console.log('\n=== QUERY TIMING ANALYSIS ===\n');
console.log('Query: "I have dr.martens high top chelsea shoes, suggest me a dress that goes well with it"\n');
console.log('Total Time:', (totalTime / 1000).toFixed(2), 'seconds\n');
console.log('Step-by-Step Breakdown:\n');

durations.forEach((d, i) => {
  const percentage = ((d.durationMs / totalTime) * 100).toFixed(1);
  const emoji = d.durationMs > 3000 ? '🔴' : d.durationMs > 1000 ? '🟡' : '✅';
  console.log(`${i + 1}. ${emoji} ${d.step}`);
  console.log(`   Duration: ${d.durationSeconds}s (${percentage}% of total)`);
  console.log('');
});

console.log('\n=== BOTTLENECK ANALYSIS ===\n');
const sorted = [...durations].sort((a, b) => b.durationMs - a.durationMs);
console.log('Slowest steps:');
sorted.slice(0, 3).forEach((d, i) => {
  console.log(`${i + 1}. ${d.step}: ${d.durationSeconds}s`);
});

console.log('\n=== ESTIMATED STEP TIMINGS ===\n');
console.log('Note: Some steps may have started before the first logged timestamp.\n');
console.log('Estimated breakdown:');
console.log('- Classification (not logged): ~1.5-2.0s (estimated)');
console.log('- Retrieval: ~0.9s (from retrieval start to ranking start)');
console.log('- Product Loading: Included in retrieval time');
console.log('- Ranking: ~0.025s (very fast)');
console.log('- Emotional Keywords: ~1.36s');
console.log('- Reply Generation: ~5.56s (LARGEST BOTTLENECK)');
console.log('- Final Processing: ~1.31s');
