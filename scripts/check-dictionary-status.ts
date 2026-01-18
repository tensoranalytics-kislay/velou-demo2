import { prisma } from '../src/lib/db';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

async function main() {
  console.log('🔍 Checking Dictionary Status\n');
  
  const constraintDictPath = join(process.cwd(), 'src/lib/loveshackfancy/constraint-dictionaries.json');
  const categoryDictPath = join(process.cwd(), 'src/lib/loveshackfancy/category-dictionaries.json');
  
  // Check constraint dictionaries
  if (existsSync(constraintDictPath)) {
    const dict = JSON.parse(readFileSync(constraintDictPath, 'utf-8'));
    console.log('✅ Constraint dictionaries exist');
    console.log(`   Total products: ${dict.totalProducts || 'unknown'}`);
    console.log(`   Extracted at: ${dict.extractedAt || 'unknown'}`);
    
    // Check current product count
    const currentCount = await prisma.product.count({ where: { isActive: true } });
    console.log(`   Current product count: ${currentCount}`);
    
    if (dict.totalProducts !== currentCount) {
      console.log(`   ⚠️  Product count mismatch - dictionary may need rebuild`);
    } else {
      console.log(`   ✅ Product count matches`);
    }
  } else {
    console.log('❌ Constraint dictionaries not found');
  }
  
  // Check category dictionaries
  if (existsSync(categoryDictPath)) {
    const dict = JSON.parse(readFileSync(categoryDictPath, 'utf-8'));
    console.log(`\n✅ Category dictionaries exist`);
    console.log(`   Categories: ${dict.totalCategories || dict.categories?.length || 'unknown'}`);
    console.log(`   Products covered: ${dict.totalProducts || 'unknown'}`);
  } else {
    console.log('\n❌ Category dictionaries not found');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
