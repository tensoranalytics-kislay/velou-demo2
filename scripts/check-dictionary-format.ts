import { loadConstraintDictionaries, formatDictionaryForPrompt } from '../src/lib/loveshackfancy/constraint-dictionaries';

const dict = loadConstraintDictionaries();

console.log('📋 How Dictionaries Are Formatted in Prompt:\n');

// Check occasions (small, so we can see full format)
console.log('1. OCCASIONS (12 values - all shown):');
console.log('─'.repeat(70));
const occasionsFormat = formatDictionaryForPrompt('occasions', 100);
console.log(occasionsFormat);
console.log();

// Check materials (large, shows first 100)
console.log('2. MATERIALS (400 total, first 100 shown):');
console.log('─'.repeat(70));
const materialsFormat = formatDictionaryForPrompt('materials', 100);
console.log(materialsFormat.substring(0, 500) + '...');
console.log();

// Check colors (large, shows first 100)
console.log('3. COLORS (582 total, first 100 shown):');
console.log('─'.repeat(70));
const colorsFormat = formatDictionaryForPrompt('colors', 100);
console.log(colorsFormat.substring(0, 500) + '...');
console.log();

console.log('🔍 Format Analysis:\n');
console.log('   Format: "CONSTRAINT_TYPE (N total):\nvalue1, value2, value3, ..."');
console.log('   Pros: ✅ Simple, compact, easy to scan');
console.log('   Cons: ⚠️  Long comma-separated lists (100+ items) might be hard to parse');
console.log('   Cons: ⚠️  LLM might miss values in the middle of long lists');
console.log();

// Count how many constraint types show ALL vs truncated
const constraintTypes = [
  'colors', 'materials', 'occasions', 'styles', 'patterns', 'sizes', 
  'lengths', 'formalityLevel', 'fits', 'rises', 'necklines', 'sleeveLengths',
  'collections', 'seasons', 'colorShade', 'colorUndertone', 'embellishments', 'seasonalPalette'
];

let allShown = 0;
let truncated = 0;

for (const type of constraintTypes) {
  const values = (dict as any)[type] || [];
  if (values.length <= 100) {
    allShown++;
  } else {
    truncated++;
  }
}

console.log('📊 Dictionary Coverage:\n');
console.log(`   Fully shown (≤100 values): ${allShown} constraint types`);
console.log(`   Truncated (>100 values): ${truncated} constraint types`);
console.log(`   - Colors: 582 total, showing 100 (17% of values)`);
console.log(`   - Materials: 400 total, showing 100 (25% of values)`);
console.log(`   - Sizes: 192 total, showing 100 (52% of values)`);

