import { readFileSync } from 'fs';
import { join } from 'path';

const logFile = join(process.cwd(), 'test-bahamas-query.log');
const logContent = readFileSync(logFile, 'utf-8');

console.log('🔍 Checking ALL Constraints Extracted by LLM Classifier\n');

// Find the parsedConstraints section
const llmResponseMatch = logContent.match(/classifyQuery: llm_raw_response[\s\S]*?parsedConstraints: \{([\s\S]*?)\s*\},/);
if (llmResponseMatch) {
  const parsedSection = llmResponseMatch[1];
  console.log('📋 Raw Parsed Constraints from LLM:\n');
  console.log(parsedSection.substring(0, 2000));
  console.log('...');
} else {
  console.log('⚠️  Could not find parsed constraints in log');
}

// Also check constraint_extraction_results
const extractionMatch = logContent.match(/constraint_extraction_results[\s\S]*?\{([\s\S]*?)\s*\},[\s\S]*?note:/);
if (extractionMatch) {
  console.log('\n\n📊 Constraint Extraction Results:\n');
  console.log(extractionMatch[1].substring(0, 1500));
}

// Check what dictionaries are available
const dictPath = join(process.cwd(), 'src/lib/loveshackfancy/constraint-dictionaries.json');
const dict = JSON.parse(readFileSync(dictPath, 'utf-8'));

console.log('\n\n📚 Available Constraint Types in Dictionary:\n');
const constraintTypes = Object.keys(dict).filter(k => Array.isArray(dict[k]));
console.log(`   Total constraint types: ${constraintTypes.length}`);
console.log(`   Types: ${constraintTypes.join(', ')}`);

