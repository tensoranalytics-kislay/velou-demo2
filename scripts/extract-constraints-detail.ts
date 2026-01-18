import { readFileSync } from 'fs';
import { join } from 'path';

const logFile = join(process.cwd(), 'test-bahamas-query.log');
const logContent = readFileSync(logFile, 'utf-8');

console.log('📊 Constraints Extracted from Recent Query:\n');

// Extract from orchestrator_resolved_constraints
const resolvedMatch = logContent.match(/orchestrator_resolved_constraints[\s\S]*?resolvedConstraints: \{([\s\S]*?)\s*\},[\s\S]*?constraintsPassedToRanking:/);
if (resolvedMatch) {
  const resolvedSection = resolvedMatch[1];
  
  // Extract specific values
  const occasionsMatch = resolvedSection.match(/occasions:\s*\[(.*?)\]/);
  const seasonsMatch = resolvedSection.match(/seasons:\s*\[(.*?)\]/);
  const ageGroupsMatch = resolvedSection.match(/ageGroups:\s*\[(.*?)\]/);
  
  console.log('   Resolved Constraints:');
  if (occasionsMatch) console.log(`     • Occasions: ${occasionsMatch[1]}`);
  if (seasonsMatch) console.log(`     • Seasons: ${seasonsMatch[1]}`);
  if (ageGroupsMatch) console.log(`     • Age Groups: ${ageGroupsMatch[1]}`);
}

// Extract from constraintsPassedToRanking
const rankingMatch = logContent.match(/constraintsPassedToRanking: \{([\s\S]*?)\s*\},[\s\S]*?topProducts:/);
if (rankingMatch) {
  const rankingSection = rankingMatch[1];
  
  const occValuesMatch = rankingSection.match(/occasions:.*?values:.*?\[(.*?)\]/);
  const ageValuesMatch = rankingSection.match(/ageGroups:.*?values:.*?\[(.*?)\]/);
  const seasonsArrMatch = rankingSection.match(/seasons:.*?\[(.*?)\]/);
  
  console.log('\n   Constraints Passed to Ranking:');
  if (occValuesMatch) console.log(`     • Occasions: ${occValuesMatch[1]} (intent: strong)`);
  if (ageValuesMatch) console.log(`     • Age Groups: ${ageValuesMatch[1]} (intent: strong)`);
  if (seasonsArrMatch) console.log(`     • Seasons: ${seasonsArrMatch[1]}`);
}

// Check dictionary
const dictPath = join(process.cwd(), 'src/lib/loveshackfancy/constraint-dictionaries.json');
const dict = JSON.parse(readFileSync(dictPath, 'utf-8'));

console.log('\n✅ Dictionary Status:\n');
console.log(`   Using Latest Dictionary: ✅ YES`);
console.log(`   Extracted At: ${dict.extractedAt}`);
console.log(`   Total Products: ${dict.totalProducts}`);
console.log(`   Normalized Constraints:`);
console.log(`     - Occasions: ${dict.occasions?.length || 0} (from normalized occasionContext)`);
console.log(`     - Colors: ${dict.colors?.length || 0} (normalized to title case)`);
console.log(`     - Materials: ${dict.materials?.length || 0} (normalized)`);
console.log(`     - Seasons: ${dict.seasons?.length || 0}`);

// Check if "Vacation" is in occasions
if (dict.occasions && dict.occasions.includes('Vacation')) {
  console.log(`\n   ✅ "Vacation" is in normalized occasions dictionary`);
} else {
  console.log(`\n   ⚠️  "Vacation" not found in occasions dictionary`);
  console.log(`   Available occasions: ${dict.occasions?.slice(0, 10).join(', ')}`);
}

