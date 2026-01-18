import { readFileSync } from 'fs';
import { join } from 'path';

const logFile = join(process.cwd(), 'test-bahamas-query.log');
const logContent = readFileSync(logFile, 'utf-8');

// Extract constraints from orchestrator_pipeline_summary
const summaryMatch = logContent.match(/orchestrator_pipeline_summary[\s\S]*?constraintsPassedToRanking:[\s\S]*?\},[\s\S]*?topProducts:/);
if (summaryMatch) {
  console.log('📊 Constraints Used in Recent Run:\n');
  
  // Extract occasions
  const occasionsMatch = logContent.match(/occasions:.*?values:.*?\[(.*?)\]/);
  if (occasionsMatch) {
    console.log(`   Occasions: ${occasionsMatch[1]}`);
  }
  
  // Extract seasons
  const seasonsMatch = logContent.match(/seasons:.*?\[(.*?)\]/);
  if (seasonsMatch) {
    console.log(`   Seasons: ${seasonsMatch[1]}`);
  }
  
  // Extract ageGroups
  const ageGroupsMatch = logContent.match(/ageGroups:.*?values:.*?\[(.*?)\]/);
  if (ageGroupsMatch) {
    console.log(`   Age Groups: ${ageGroupsMatch[1]}`);
  }
}

// Check dictionary info
const dictPath = join(process.cwd(), 'src/lib/loveshackfancy/constraint-dictionaries.json');
const dict = JSON.parse(readFileSync(dictPath, 'utf-8'));

console.log('\n📚 Constraint Dictionary Info:\n');
console.log(`   Total Products: ${dict.totalProducts}`);
console.log(`   Extracted At: ${dict.extractedAt}`);
console.log(`   Colors: ${dict.colors?.length || 0}`);
console.log(`   Materials: ${dict.materials?.length || 0}`);
console.log(`   Occasions: ${dict.occasions?.length || 0}`);
console.log(`   Seasons: ${dict.seasons?.length || 0}`);
console.log(`   Lengths: ${dict.lengths?.length || 0}`);
console.log(`   Formality Levels: ${dict.formalityLevel?.length || 0}`);

// Show sample occasions from dictionary
if (dict.occasions && dict.occasions.length > 0) {
  console.log(`\n   Sample Occasions: ${dict.occasions.slice(0, 5).join(', ')}`);
}
if (dict.seasons && dict.seasons.length > 0) {
  console.log(`   Sample Seasons: ${dict.seasons.slice(0, 5).join(', ')}`);
}

