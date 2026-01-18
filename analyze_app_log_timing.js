const fs = require('fs');
const path = require('path');

const logFilePath = path.join(process.cwd(), 'app.log');

if (!fs.existsSync(logFilePath)) {
  console.error('Log file not found:', logFilePath);
  process.exit(1);
}

const logContent = fs.readFileSync(logFilePath, 'utf8');
const lines = logContent.split('\n');

// Extract timing events
const events = [];
let currentTimestamp = null;
let currentMessage = null;
let currentJson = '';

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Check for timestamp
  const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/);
  if (timestampMatch) {
    // Save previous event if we have one
    if (currentMessage && currentJson) {
      // Try to extract duration from JSON
      const durationMsMatch = currentJson.match(/(\w+DurationMs|totalDurationMs|llmDurationMs|elapsedMs):\s*(\d+)/);
      const durationSecondsMatch = currentJson.match(/(\w+DurationSeconds):\s*'?([\d.]+)'?/);
      
      if (durationMsMatch) {
        events.push({
          timestamp: currentTimestamp,
          message: currentMessage,
          fieldName: durationMsMatch[1],
          duration: parseInt(durationMsMatch[2]),
        });
      } else if (durationSecondsMatch) {
        events.push({
          timestamp: currentTimestamp,
          message: currentMessage,
          fieldName: durationSecondsMatch[1],
          duration: Math.round(parseFloat(durationSecondsMatch[2]) * 1000),
        });
      }
    }
    
    currentTimestamp = timestampMatch[1];
    currentJson = '';
  }
  
  // Extract message
  const messageMatch = line.match(/message:\s*'([^']+)'/);
  if (messageMatch) {
    currentMessage = messageMatch[1];
  }
  
  // Accumulate JSON content
  if (line.includes('{') || currentJson) {
    currentJson += line + '\n';
    if (line.includes('}')) {
      // JSON block complete, try to extract duration
      const durationMsMatch = currentJson.match(/(\w+DurationMs|totalDurationMs|llmDurationMs|elapsedMs):\s*(\d+)/);
      const durationSecondsMatch = currentJson.match(/(\w+DurationSeconds):\s*'?([\d.]+)'?/);
      
      if (durationMsMatch && currentMessage) {
        events.push({
          timestamp: currentTimestamp,
          message: currentMessage,
          fieldName: durationMsMatch[1],
          duration: parseInt(durationMsMatch[2]),
        });
      } else if (durationSecondsMatch && currentMessage) {
        events.push({
          timestamp: currentTimestamp,
          message: currentMessage,
          fieldName: durationSecondsMatch[1],
          duration: Math.round(parseFloat(durationSecondsMatch[2]) * 1000),
        });
      }
      currentJson = '';
    }
  }
}

// Get recent events (last 100)
const recentEvents = events.slice(-100);

if (recentEvents.length === 0) {
  console.log('No timing events found in app.log');
  console.log('Total log lines:', lines.length);
  console.log('\nLast 20 lines of log:');
  lines.slice(-20).forEach(line => console.log(line));
  process.exit(0);
}

console.log('=== QUERY TIMING ANALYSIS FROM APP.LOG ===\n');
console.log(`Found ${events.length} timing events in log file\n`);

// Find the most recent query by looking for complete events
const steps = [];

// Classification
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

// Retrieval
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

// Product Loading
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

// Ranking
const rankingComplete = recentEvents.find(e => 
  e.message === 'handleLoveshackfancyQuery: ranking_complete' && e.fieldName === 'rankingDurationMs'
);
if (rankingComplete) {
  steps.push({
    name: 'Ranking',
    duration: rankingComplete.duration,
    timestamp: rankingComplete.timestamp,
  });
}

// Reply Generation
const generateReplyComplete = recentEvents.find(e => 
  e.message === 'generateReply: complete' && e.fieldName === 'totalDurationMs'
);
if (generateReplyComplete) {
  steps.push({
    name: 'Reply Generation (Total)',
    duration: generateReplyComplete.duration,
    timestamp: generateReplyComplete.timestamp,
  });
  
  // Also get LLM duration
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
let totalTime = 0;
if (steps.length > 0) {
  const firstStep = steps[0];
  const lastStep = steps[steps.length - 1];
  if (firstStep && lastStep) {
    const firstTime = new Date(firstStep.timestamp).getTime();
    const lastTime = new Date(lastStep.timestamp).getTime();
    totalTime = lastTime - firstTime;
  }
  
  // Also sum durations for comparison
  const sumDurations = steps.reduce((sum, step) => sum + step.duration, 0);
  if (sumDurations > totalTime) {
    totalTime = sumDurations;
  }
}

if (steps.length === 0) {
  console.log('No complete query timing found. Showing all recent timing events:\n');
  recentEvents.forEach(e => {
    const time = e.timestamp ? e.timestamp.substring(11, 23) : 'N/A';
    console.log(`${time} - ${e.message}: ${e.duration}ms (${e.fieldName})`);
  });
  process.exit(0);
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
  console.log('Total time calculated from step durations.\n');
}

// Sort by duration
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
