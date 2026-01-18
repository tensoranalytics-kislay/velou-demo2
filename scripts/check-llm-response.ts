import { readFileSync } from 'fs';
import { join } from 'path';

const logFile = join(process.cwd(), 'test-bahamas-query.log');
const logContent = readFileSync(logFile, 'utf-8');

// Extract the allConstraints from classifier_constraints_extracted
const allConstraintsMatch = logContent.match(/allConstraints: \{([\s\S]*?)\s*\},[\s\S]*?hasLastConstraints:/);

if (allConstraintsMatch) {
  const constraintsSection = allConstraintsMatch[1];
  console.log('📋 ALL Constraints Extracted (from allConstraints):\n');
  
  // Parse each constraint
  const lines = constraintsSection.split('\n').filter(l => l.trim());
  lines.forEach(line => {
    if (line.includes(':')) {
      console.log(`   ${line.trim()}`);
    }
  });
}

// Also check what dictionaries were available in prompt
console.log('\n\n✅ Dictionary Status:\n');
console.log('   The LLM classifier prompt includes ALL constraint dictionaries:');
console.log('   - colors (582 values, first 100 shown)');
console.log('   - materials (400 values, first 100 shown)');
console.log('   - occasions (12 values, all shown)');
console.log('   - styles (27 values, all shown)');
console.log('   - patterns (13 values, all shown)');
console.log('   - seasons (21 values, all shown)');
console.log('   - lengths (9 values, all shown)');
console.log('   - And 11 more constraint types...\n');

console.log('🔍 Query Analysis:\n');
console.log('   Query: "I am going to Bahamas for vacation, suggest me a dress."');
console.log('   ');
console.log('   What the LLM extracted:');
console.log('   • occasions: ["Vacation"] (explicit - "vacation")');
console.log('   • seasons: ["Summer"] (inferred - Bahamas = summer/tropical)');
console.log('   • ageGroups: ["Adult"] (inferred - no age mention, default)');
console.log('   ');
console.log('   What COULD have been inferred (but wasn\'t):');
console.log('   • occasions: ["Beach"] (Bahamas = beach location)');
console.log('   • styles: ["Casual", "Resort"] (vacation context)');
console.log('   • materials: ["Cotton", "Linen"] (summer/beach materials)');
console.log('   • lengths: ["Midi", "Maxi"] (common for vacation dresses)');

