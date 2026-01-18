import { loadConstraintDictionaries, formatDictionaryForPrompt } from '../src/lib/loveshackfancy/constraint-dictionaries';
import { buildQueryClassifierPrompt } from '../src/lib/loveshackfancy/prompts';

const dict = loadConstraintDictionaries();

console.log('📊 Dictionary Sizes in Prompt:\n');

const constraintTypes = [
  'colors', 'materials', 'occasions', 'styles', 'patterns', 'sizes', 
  'lengths', 'formalityLevel', 'fits', 'rises', 'necklines', 'sleeveLengths',
  'collections', 'seasons', 'colorShade', 'colorUndertone', 'embellishments', 'seasonalPalette'
];

let totalDictionaryChars = 0;
const dictSizes: Array<{type: string; total: number; shown: number; chars: number}> = [];

for (const type of constraintTypes) {
  const values = (dict as any)[type] || [];
  const formatted = formatDictionaryForPrompt(type, 100);
  const chars = formatted.length;
  totalDictionaryChars += chars;
  
  dictSizes.push({
    type,
    total: values.length,
    shown: Math.min(values.length, 100),
    chars
  });
}

dictSizes.sort((a, b) => b.chars - a.chars);

console.log('   Constraint Type             Total    Shown   Characters in Prompt');
console.log('   ' + '-'.repeat(65));
dictSizes.forEach(d => {
  console.log(`   ${d.type.padEnd(25)} ${d.total.toString().padStart(6)}  ${d.shown.toString().padStart(6)}  ${d.chars.toString().padStart(6)}`);
});

console.log('\n   ' + '-'.repeat(65));
console.log(`   ${'TOTAL'.padEnd(25)} ${' '.repeat(14)} ${totalDictionaryChars.toString().padStart(6)} characters`);

// Estimate tokens (rough: 1 token ≈ 4 characters for English)
const estimatedTokens = Math.ceil(totalDictionaryChars / 4);
console.log(`\n   Estimated tokens (dictionaries only): ~${estimatedTokens.toLocaleString()}`);

// Build a sample prompt
const samplePrompt = buildQueryClassifierPrompt(['Women\'s Dresses', 'Tops', 'Girls Dresses']);
const samplePromptLength = samplePrompt.length;
const samplePromptTokens = Math.ceil(samplePromptLength / 4);

console.log(`\n📝 Sample Prompt Length:`);
console.log(`   Total characters: ${samplePromptLength.toLocaleString()}`);
console.log(`   Estimated tokens: ~${samplePromptTokens.toLocaleString()}`);
console.log(`   Dictionary portion: ${((totalDictionaryChars / samplePromptLength) * 100).toFixed(1)}%`);

// Check token limits
console.log(`\n🔍 Token Limit Analysis:`);
console.log(`   GPT-4.1-mini context window: 128,000 tokens`);
console.log(`   Current prompt estimate: ~${samplePromptTokens.toLocaleString()} tokens`);
console.log(`   Usage: ${((samplePromptTokens / 128000) * 100).toFixed(2)}% of context window`);
console.log(`   Max tokens for response: 2000 (set in schema)`);

if (samplePromptTokens > 100000) {
  console.log(`\n   ⚠️  WARNING: Prompt is very large (>100k tokens), might affect LLM performance`);
} else if (samplePromptTokens > 50000) {
  console.log(`\n   ⚠️  CAUTION: Prompt is large (>50k tokens), could slow down processing`);
} else {
  console.log(`\n   ✅ Prompt size is reasonable`);
}

