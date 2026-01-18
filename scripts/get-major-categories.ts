import categoryDictionariesJson from '../src/lib/loveshackfancy/category-dictionaries.json';

const { categories } = categoryDictionariesJson as { categories: string[] };

console.log(`📊 Major Categories (${categories.length} total):\n`);
categories.forEach((cat, i) => {
  console.log(`   ${(i + 1).toString().padStart(2)}. ${cat}`);
});
console.log();
