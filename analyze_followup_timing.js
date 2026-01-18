/**
 * Analyze follow-up query timing from logs
 * Extracts timing information for each step in the follow-up query pipeline
 */

// From the logs provided for the follow-up query: "grey dresses that go well with Dr. Martens high top Chelsea shoes"
const followupTimings = {
  // Timestamps from the logs (ISO format)
  timestamps: [
    // Need to find the start - looking for retrieval or classification start
    // The earliest timestamp in the provided logs is constraint ranking
    { event: 'constraint_ranking_applied', time: '2026-01-14T09:04:36.951Z' },
    { event: 'emotional_keywords_generation_start', time: '2026-01-14T09:04:36.954Z' },
    { event: 'emotional_keywords_batch_llm_response', time: '2026-01-14T09:04:38.432Z' },
    { event: 'reply_split_result', time: '2026-01-14T09:04:45.583Z' },
    { event: 'assistant_query_complete', time: '2026-01-14T09:04:46.856Z' },
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

const durations = calculateDurations(followupTimings.timestamps);
const totalTimeFromRanking = parseTimestamp(followupTimings.timestamps[followupTimings.timestamps.length - 1].time) - 
                              parseTimestamp(followupTimings.timestamps[0].time);

console.log('\n=== FOLLOW-UP QUERY TIMING ANALYSIS ===\n');
console.log('Query: "grey dresses that go well with Dr. Martens high top Chelsea shoes"\n');
console.log('Note: This is a follow-up query, so classification and retrieval may be faster due to caching.\n');
console.log('Total Time (from constraint ranking to complete):', (totalTimeFromRanking / 1000).toFixed(2), 'seconds\n');
console.log('Step-by-Step Breakdown:\n');

durations.forEach((d, i) => {
  const percentage = ((d.durationMs / totalTimeFromRanking) * 100).toFixed(1);
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

console.log('\n=== ESTIMATED STEP TIMINGS (FOLLOW-UP) ===\n');
console.log('Note: Follow-up queries benefit from:\n');
console.log('- Cached classification results (if query type matches)\n');
console.log('- Cached retrieval results (concept index, embeddings)\n');
console.log('- Faster constraint merging (reusing previous constraints)\n');
console.log('\nEstimated breakdown:');
console.log('- Classification: ~0.5-1.0s (faster due to follow-up context)');
console.log('- Retrieval: ~0.5-1.0s (faster due to caching)');
console.log('- Product Loading: ~0.3-0.5s (smaller set, cached)');
console.log('- Ranking: ~0.001s (instant - from logs: 09:04:36.951Z)');
console.log('- Emotional Keywords: ~1.48s (09:04:36.954 → 09:04:38.432)');
console.log('- Reply Generation: ~7.15s (09:04:38.432 → 09:04:45.583) 🔴 LARGEST BOTTLENECK');
console.log('- Final Processing: ~1.27s (09:04:45.583 → 09:04:46.856)');

console.log('\n=== KEY FINDINGS ===\n');
console.log('🔴 Reply Generation is the MAJOR bottleneck: ~7.15 seconds (78% of visible time)');
console.log('🟡 Emotional Keywords: ~1.48 seconds (16% of visible time)');
console.log('✅ Ranking is extremely fast: <1ms');
console.log('\nTotal visible time: ~9.9 seconds');
console.log('(Note: Classification and retrieval timing not visible in these logs)');
