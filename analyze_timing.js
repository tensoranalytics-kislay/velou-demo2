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

// Extract timestamps and timing information
const timingPatterns = [
  {
    name: 'Overall Query Start',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'handleLoveshackfancyQuery: starting'/g,
  },
  {
    name: 'Classification Start',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'classifyQuery: starting'/g,
  },
  {
    name: 'Classification Complete',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'classifyQuery: complete'[\s\S]*?totalDurationMs: (\d+)/g,
    extractDuration: true,
  },
  {
    name: 'Retrieval Start',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'handleLoveshackfancyQuery: starting_retrieval'/g,
  },
  {
    name: 'Retrieval Complete',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'handleLoveshackfancyQuery: retrieval_complete'[\s\S]*?retrievalDurationMs: (\d+)/g,
    extractDuration: true,
  },
  {
    name: 'Product Loading Complete',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'handleLoveshackfancyQuery: product_loading_complete'[\s\S]*?productLoadingDurationMs: (\d+)/g,
    extractDuration: true,
  },
  {
    name: 'Ranking Start',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'handleLoveshackfancyQuery: starting_ranking'/g,
  },
  {
    name: 'Ranking Complete',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'handleLoveshackfancyQuery: ranking_complete'[\s\S]*?rankingDurationMs: (\d+)/g,
    extractDuration: true,
  },
  {
    name: 'Reply Generation Start',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'handleLoveshackfancyQuery: starting_reply_generation'/g,
  },
  {
    name: 'Generate Reply Start',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'generateReply: starting'/g,
  },
  {
    name: 'Generate Reply Complete',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'generateReply: complete'[\s\S]*?totalDurationMs: (\d+)/g,
    extractDuration: true,
  },
  {
    name: 'Reply Generation Complete',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'handleLoveshackfancyQuery: reply_generation_complete'[\s\S]*?replyDurationMs: (\d+)/g,
    extractDuration: true,
  },
  {
    name: 'Emotional Keywords Start',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'emotional_keywords_generation_start'/g,
  },
  {
    name: 'Emotional Keywords LLM Response',
    regex: /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[Velou:INFO\] \{[\s\S]*?message: 'emotional_keywords_batch_llm_response'/g,
  },
];

function extractTimestamp(match) {
  if (!match) return null;
  return new Date(match[1]).getTime();
}

function findLatestQuery() {
  // Find the most recent query by looking for the last "handleLoveshackfancyQuery: starting"
  const queryStartMatches = [...logContent.matchAll(timingPatterns[0].regex)];
  if (queryStartMatches.length === 0) {
    // Try to find from classification or other markers
    const classificationMatches = [...logContent.matchAll(timingPatterns[1].regex)];
    if (classificationMatches.length === 0) {
      console.log('No query start found, analyzing all logs...');
      return null;
    }
    return classificationMatches[classificationMatches.length - 1];
  }
  return queryStartMatches[queryStartMatches.length - 1];
}

const latestQueryStart = findLatestQuery();
if (!latestQueryStart) {
  console.log('Analyzing the most recent complete query from logs...\n');
}

// Extract all timing events
const events = [];
for (const pattern of timingPatterns) {
  const matches = [...logContent.matchAll(pattern.regex)];
  for (const match of matches) {
    const timestamp = extractTimestamp(match);
    if (timestamp) {
      events.push({
        name: pattern.name,
        timestamp,
        duration: pattern.extractDuration && match[2] ? parseInt(match[2]) : null,
      });
    }
  }
}

// Sort by timestamp
events.sort((a, b) => a.timestamp - b.timestamp);

// Find the most recent query (last 2 minutes of events or last complete query)
const now = Date.now();
const recentEvents = events.filter(e => {
  // If we found a query start, use events after it
  if (latestQueryStart) {
    const queryStartTime = extractTimestamp(latestQueryStart);
    return e.timestamp >= queryStartTime;
      }
  // Otherwise, use events from last 5 minutes
  return (now - e.timestamp) < 5 * 60 * 1000;
});

if (recentEvents.length === 0) {
  console.log('No recent timing events found. Showing last 20 events:\n');
  events.slice(-20).forEach(e => {
    const time = new Date(e.timestamp).toISOString();
    console.log(`${time} - ${e.name}${e.duration ? ` (${e.duration}ms)` : ''}`);
  });
  process.exit(0);
}

console.log('=== QUERY TIMING ANALYSIS ===\n');

// Group events by query
const queryEvents = [];
let currentQuery = [];

for (const event of recentEvents) {
  if (event.name === 'Overall Query Start' || event.name === 'Classification Start') {
    if (currentQuery.length > 0) {
      queryEvents.push([...currentQuery]);
    }
    currentQuery = [event];
  } else {
    currentQuery.push(event);
  }
}
if (currentQuery.length > 0) {
  queryEvents.push(currentQuery);
}

// Analyze the most recent complete query
const latestQuery = queryEvents[queryEvents.length - 1] || recentEvents;

console.log(`Analyzing ${latestQuery.length} timing events from the most recent query\n`);

// Calculate step durations
const steps = [];

// Find classification
const classificationStart = latestQuery.find(e => e.name === 'Classification Start');
const classificationComplete = latestQuery.find(e => e.name === 'Classification Complete');
if (classificationComplete && classificationComplete.duration) {
  steps.push({
    name: 'Classification',
    duration: classificationComplete.duration,
    start: classificationStart?.timestamp,
    end: classificationComplete.timestamp,
  });
} else if (classificationStart && classificationComplete) {
  steps.push({
    name: 'Classification',
    duration: classificationComplete.timestamp - classificationStart.timestamp,
    start: classificationStart.timestamp,
    end: classificationComplete.timestamp,
  });
}

// Find retrieval
const retrievalStart = latestQuery.find(e => e.name === 'Retrieval Start');
const retrievalComplete = latestQuery.find(e => e.name === 'Retrieval Complete');
if (retrievalComplete && retrievalComplete.duration) {
  steps.push({
    name: 'Retrieval',
    duration: retrievalComplete.duration,
    start: retrievalStart?.timestamp,
    end: retrievalComplete.timestamp,
  });
} else if (retrievalStart && retrievalComplete) {
  steps.push({
    name: 'Retrieval',
    duration: retrievalComplete.timestamp - retrievalStart.timestamp,
    start: retrievalStart.timestamp,
    end: retrievalComplete.timestamp,
  });
}

// Find product loading
const productLoadingComplete = latestQuery.find(e => e.name === 'Product Loading Complete');
if (productLoadingComplete && productLoadingComplete.duration) {
  steps.push({
    name: 'Product Loading',
    duration: productLoadingComplete.duration,
    start: null,
    end: productLoadingComplete.timestamp,
  });
}

// Find ranking
const rankingStart = latestQuery.find(e => e.name === 'Ranking Start');
const rankingComplete = latestQuery.find(e => e.name === 'Ranking Complete');
if (rankingComplete && rankingComplete.duration) {
  steps.push({
    name: 'Ranking',
    duration: rankingComplete.duration,
    start: rankingStart?.timestamp,
    end: rankingComplete.timestamp,
  });
} else if (rankingStart && rankingComplete) {
  steps.push({
    name: 'Ranking',
    duration: rankingComplete.timestamp - rankingStart.timestamp,
    start: rankingStart.timestamp,
    end: rankingComplete.timestamp,
  });
}

// Find emotional keywords
const emotionalKeywordsStart = latestQuery.find(e => e.name === 'Emotional Keywords Start');
const emotionalKeywordsLLM = latestQuery.find(e => e.name === 'Emotional Keywords LLM Response');
if (emotionalKeywordsStart && emotionalKeywordsLLM) {
  steps.push({
    name: 'Emotional Keywords Generation',
    duration: emotionalKeywordsLLM.timestamp - emotionalKeywordsStart.timestamp,
    start: emotionalKeywordsStart.timestamp,
    end: emotionalKeywordsLLM.timestamp,
  });
}

// Find reply generation
const replyGenStart = latestQuery.find(e => e.name === 'Reply Generation Start');
const generateReplyStart = latestQuery.find(e => e.name === 'Generate Reply Start');
const generateReplyComplete = latestQuery.find(e => e.name === 'Generate Reply Complete');
const replyGenComplete = latestQuery.find(e => e.name === 'Reply Generation Complete');

if (generateReplyComplete && generateReplyComplete.duration) {
  steps.push({
    name: 'Reply Generation (LLM)',
    duration: generateReplyComplete.duration,
    start: generateReplyStart?.timestamp,
    end: generateReplyComplete.timestamp,
  });
} else if (generateReplyStart && generateReplyComplete) {
  steps.push({
    name: 'Reply Generation (LLM)',
    duration: generateReplyComplete.timestamp - generateReplyStart.timestamp,
    start: generateReplyStart.timestamp,
    end: generateReplyComplete.timestamp,
  });
}

// Calculate total time
const firstEvent = latestQuery[0];
const lastEvent = latestQuery[latestQuery.length - 1];
const totalTime = lastEvent.timestamp - firstEvent.timestamp;

console.log('Step-by-Step Breakdown:\n');
steps.forEach((step, index) => {
  const seconds = (step.duration / 1000).toFixed(2);
  const percentage = totalTime > 0 ? ((step.duration / totalTime) * 100).toFixed(1) : 'N/A';
  let status = '✅';
  if (step.duration > 5000) status = '🔴';
  else if (step.duration > 1000) status = '🟡';
  
  console.log(`${status} ${index + 1}. ${step.name}`);
  console.log(`   Duration: ${step.duration}ms (${seconds}s) - ${percentage}% of total`);
  if (step.start && step.end) {
    const startTime = new Date(step.start).toISOString().substring(11, 23);
    const endTime = new Date(step.end).toISOString().substring(11, 23);
    console.log(`   Time: ${startTime} → ${endTime}`);
  }
  console.log('');
});

console.log(`\n=== SUMMARY ===\n`);
console.log(`Total Query Time: ${(totalTime / 1000).toFixed(2)}s (${totalTime}ms)\n`);

// Sort by duration to find bottlenecks
const sortedSteps = [...steps].sort((a, b) => b.duration - a.duration);
console.log('Slowest Steps:');
sortedSteps.slice(0, 5).forEach((step, index) => {
  const seconds = (step.duration / 1000).toFixed(2);
  console.log(`${index + 1}. ${step.name}: ${seconds}s`);
});

console.log('\n=== ALL TIMING EVENTS ===\n');
latestQuery.forEach(event => {
  const time = new Date(event.timestamp).toISOString().substring(11, 23);
  console.log(`${time} - ${event.name}${event.duration ? ` (${event.duration}ms)` : ''}`);
});
