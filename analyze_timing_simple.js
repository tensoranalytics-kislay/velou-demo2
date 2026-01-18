const fs = require('fs');
const path = require('path');

const logFilePath = path.join(
  process.env.HOME,
  '.cursor/projects/Users-k1zzle-Library-Application-Support-Cursor-Workspaces-1768162279223-workspace-json/terminals/3.txt'
);

if (!fs.existsSync(logFilePath)) {
  console.error('Log file not found:', logFilePath);
  process.exit(1);
}

const logContent = fs.readFileSync(logFilePath, 'utf8');

// Extract all timing events with their durations
const events = [];

// Pattern to match log entries with timestamps
const logLinePattern = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:(INFO|DEBUG|ERROR|WARN)\]/g;

let match;
const lines = logContent.split('\n');
let currentTimestamp = null;
let currentMessage = null;
let currentData = {};

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Check for timestamp
  const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/);
  if (timestampMatch) {
    currentTimestamp = timestampMatch[1];
    currentData = {};
  }
  
  // Extract message
  const messageMatch = line.match(/message: '([^']+)'/);
  if (messageMatch) {
    currentMessage = messageMatch[1];
  }
  
  // Extract duration fields
  const durationMsMatch = line.match(/(\w+DurationMs|totalDurationMs|llmDurationMs|elapsedMs): (\d+)/);
  if (durationMsMatch && currentMessage) {
    const fieldName = durationMsMatch[1];
    const duration = parseInt(durationMsMatch[2]);
    
    events.push({
      timestamp: currentTimestamp,
      message: currentMessage,
      fieldName,
      duration,
    });
  }
  
  // Also extract rankingDurationSeconds, etc. for verification
  const durationSecondsMatch = line.match(/(\w+DurationSeconds): '([\d.]+)'/);
  if (durationSecondsMatch && currentMessage) {
    const fieldName = durationSecondsMatch[1];
    const durationSeconds = parseFloat(durationSecondsMatch[2]);
    
    // Convert to ms for consistency
    events.push({
      timestamp: currentTimestamp,
      message: currentMessage,
      fieldName,
      duration: Math.round(durationSeconds * 1000),
    });
  }
}

// Group events by query (find the most recent complete query)
const recentEvents = events.slice(-50); // Last 50 events

console.log('=== QUERY TIMING ANALYSIS ===\n');
console.log(`Found ${events.length} timing events in logs\n`);

// Find the most recent query by looking for the last "ranking_complete" or "reply_generation_complete"
const rankingComplete = recentEvents.find(e => e.message === 'handleLoveshackfancyQuery: ranking_complete');
const replyComplete = recentEvents.find(e => e.message === 'handleLoveshackfancyQuery: reply_generation_complete' || e.message === 'generateReply: complete');

if (!rankingComplete && !replyComplete) {
  console.log('No complete query found. Showing all recent timing events:\n');
  recentEvents.forEach(e => {
    console.log(`${e.timestamp} - ${e.message}: ${e.duration}ms (${e.fieldName})`);
  });
  process.exit(0);
}

// Extract timing information from the most recent query
const steps = [];

// Find classification
const classificationComplete = recentEvents.find(e => 
  e.message === 'classifyQuery: complete' && e.fieldName === 'totalDurationMs'
);
if (classificationComplete) {
  steps.push({
    name: 'Classification',
    duration: classificationComplete.duration,
    timestamp: classificationComplete.timestamp,
  });
}

// Find retrieval
const retrievalComplete = recentEvents.find(e => 
  e.message === 'handleLoveshackfancyQuery: retrieval_complete' && e.fieldName === 'retrievalDurationMs'
);
if (retrievalComplete) {
  steps.push({
    name: 'Retrieval',
    duration: retrievalComplete.duration,
    timestamp: retrievalComplete.timestamp,
  });
}

// Find product loading
const productLoadingComplete = recentEvents.find(e => 
  e.message === 'handleLoveshackfancyQuery: product_loading_complete' && e.fieldName === 'productLoadingDurationMs'
);
if (productLoadingComplete) {
  steps.push({
    name: 'Product Loading',
    duration: productLoadingComplete.duration,
    timestamp: productLoadingComplete.timestamp,
  });
}

// Find ranking
if (rankingComplete) {
  steps.push({
    name: 'Ranking',
    duration: rankingComplete.duration,
    timestamp: rankingComplete.timestamp,
  });
}

// Find emotional keywords (calculate from timestamps)
const emotionalKeywordsStart = recentEvents.find(e => e.message === 'emotional_keywords_generation_start');
const emotionalKeywordsLLM = recentEvents.find(e => e.message === 'emotional_keywords_batch_llm_response');
if (emotionalKeywordsStart && emotionalKeywordsLLM) {
  const startTime = new Date(emotionalKeywordsStart.timestamp).getTime();
  const endTime = new Date(emotionalKeywordsLLM.timestamp).getTime();
  steps.push({
    name: 'Emotional Keywords Generation',
    duration: endTime - startTime,
    timestamp: emotionalKeywordsLLM.timestamp,
  });
}

// Find reply generation
const generateReplyComplete = recentEvents.find(e => 
  e.message === 'generateReply: complete' && e.fieldName === 'totalDurationMs'
);
if (generateReplyComplete) {
  steps.push({
    name: 'Reply Generation (Total)',
    duration: generateReplyComplete.duration,
    timestamp: generateReplyComplete.timestamp,
  });
  
  // Also get LLM duration if available
  const llmDuration = recentEvents.find(e => 
    e.message === 'generateReply: complete' && e.fieldName === 'llmDurationMs'
  );
  if (llmDuration) {
    steps.push({
      name: 'Reply Generation (LLM Call)',
      duration: llmDuration.duration,
      timestamp: generateReplyComplete.timestamp,
    });
  }
}

const replyGenComplete = recentEvents.find(e => 
  e.message === 'handleLoveshackfancyQuery: reply_generation_complete' && e.fieldName === 'replyDurationMs'
);
if (replyGenComplete) {
  steps.push({
    name: 'Reply Generation (Orchestrator)',
    duration: replyGenComplete.duration,
    timestamp: replyGenComplete.timestamp,
  });
}

// Calculate total time
const firstStep = steps[0];
const lastStep = steps[steps.length - 1];
let totalTime = 0;
if (firstStep && lastStep) {
  const firstTime = new Date(firstStep.timestamp).getTime();
  const lastTime = new Date(lastStep.timestamp).getTime();
  totalTime = lastTime - firstTime;
  
  // Also sum individual durations for comparison
  const sumDurations = steps.reduce((sum, step) => sum + step.duration, 0);
  if (sumDurations > totalTime) {
    totalTime = sumDurations; // Use sum if it's larger (parallel operations)
  }
}

console.log('Step-by-Step Breakdown:\n');
steps.forEach((step, index) => {
  const seconds = (step.duration / 1000).toFixed(2);
  const percentage = totalTime > 0 ? ((step.duration / totalTime) * 100).toFixed(1) : 'N/A';
  let status = '✅';
  if (step.duration > 5000) status = '🔴';
  else if (step.duration > 1000) status = '🟡';
  
  console.log(`${status} ${index + 1}. ${step.name}`);
  console.log(`   Duration: ${step.duration}ms (${seconds}s) - ${percentage}% of total`);
  console.log(`   Timestamp: ${step.timestamp}`);
  console.log('');
});

console.log(`\n=== SUMMARY ===\n`);
if (totalTime > 0) {
  console.log(`Total Query Time: ${(totalTime / 1000).toFixed(2)}s (${totalTime}ms)\n`);
} else {
  console.log('Total time could not be calculated from available data.\n');
}

// Sort by duration to find bottlenecks
const sortedSteps = [...steps].sort((a, b) => b.duration - a.duration);
if (sortedSteps.length > 0) {
  console.log('Slowest Steps:');
  sortedSteps.slice(0, 5).forEach((step, index) => {
    const seconds = (step.duration / 1000).toFixed(2);
    console.log(`${index + 1}. ${step.name}: ${seconds}s`);
  });
}

console.log('\n=== ALL RECENT TIMING EVENTS ===\n');
recentEvents.forEach(event => {
  const time = event.timestamp ? event.timestamp.substring(11, 23) : 'N/A';
  console.log(`${time} - ${event.message}: ${event.duration}ms (${event.fieldName})`);
});
