import { prisma } from './src/lib/db';

// These are the product IDs that passed post-SQL filtering (from logs)
const filteredProductIds = [
  'fvlt-marc-crim',
  'long-sleeve-v-neck-marcy',
  '8271027962041',
  '8244337475769',
  'rhlt-rydr-whit',
  '8221222404281',
  '8221229842617',
  '100042416',
  '8220208922809',
  '100042264',
  'fclt-marc-blac',
  '201264551',
  'long-sleeve-crew-tee-marcy-dummy',
  '8203037671609',
  '8217313247417',
  '8217313673401',
  '8270956757177',
  '7868678439097',
  '8271025537209',
  '8084019839161',
  '8179608387769',
  '100041168',
  '100041169',
  '201308000',
  '8271040643257',
  '8203036655801',
  '8221222338745',
  '8244337443001',
  '8244345897145',
  '8043996938425',
  '8064886964409',
  '203562025',
  '8162618343609',
  '8221220372665',
  '200983551',
  '8097708507321',
  '8217312788665',
  '8217312886969',
  '8059578056889',
  '8084016201913',
  '8084019445945',
  '8084019675321',
  '8106450911417',
  '8106592075961',
  '8106592338105',
  '8109480476857',
  '8217312755897',
  '8217313706169',
  '8179604979897',
  '8179608944825',
  '8179608977593',
  '8244337606841',
  '8193121583289',
  '8193122205881',
  '8203036917945',
  '8203037999289',
  '8203038097593',
  '8203050942649',
  '8221229908153',
  '8244347895993',
  '8244347240633',
  '8244347273401',
  '8244348190905',
  '7569593106617',
  '7984819863737',
  '8244349042873',
  '8038485164217',
  '8255715541177',
  '8259416752313',
  '8061024010425',
  '8084019871929',
  '8271021015225',
  '8271020982457',
  '8271071969465',
  '100003355',
  '8271056273593',
  '8179608518841',
  '8271072198841',
  '8271072493753',
  '8179608551609',
  '8179609469113',
  '8179609141433',
  '8179609272505',
  '8193121943737',
  '8193122009273',
  '8244347011257',
  '8244348256441',
  '8203037442233',
  '8203037573305',
  '8227891478713',
  '8097708212409',
  '8097726791865',
  '8244337574073',
  '8244347207865',
  '8271020490937',
  '202054057',
  '8203037343929',
  '8179609370809',
  'fclt-marc-heag',
  'fclt-marc-whit',
  '8270956724409',
  'fvlt-marc-heag',
  '8179609338041',
  '8179609403577',
  '202054000',
  '201237150',
  '8217312690361',
  '8221222535353',
  '8244338753721',
  '8244348059833',
  '8244348387513',
  '8244349075641',
  '8270956462265',
  '8270956560569',
  '8271020523705'
];

async function checkFilteredProducts() {
  console.log('================================================================================');
  console.log('CHECKING FILTERED PRODUCTS (116 products that passed post-SQL filtering)');
  console.log('================================================================================\n');
  
  // Check products from the filtered list
  const products = await prisma.$queryRaw<Array<{ 
    id: string; 
    title: string; 
    category: string;
    subcategory: string | null;
    sleeve: string | null;
    ageGroup: string | null;
    enriched_color: string | null;
  }>>`
    SELECT 
      p.id,
      p.title,
      p."category",
      p."subcategory",
      p."sleeve",
      p."ageGroup",
      p.attributes->>'enriched_color' as enriched_color
    FROM "Product" p
    WHERE p.id = ANY(ARRAY[${filteredProductIds.map(id => `'${id.replace(/'/g, "''")}'`).join(', ')}]::text[])
    ORDER BY p."category", p.title
    LIMIT 50
  `;
  
  console.log(`Found ${products.length} products from filtered list\n`);
  
  // Group by category
  const byCategory = new Map<string, typeof products>();
  products.forEach(p => {
    const cat = p.category;
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push(p);
  });
  
  console.log('Products by category:');
  byCategory.forEach((prods, cat) => {
    console.log(`\n${cat}: ${prods.length} products`);
    prods.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.title}`);
      console.log(`     ID: ${p.id}`);
      console.log(`     Sleeve: ${p.sleeve || 'N/A'}`);
      console.log(`     Category: ${p.category}`);
      console.log(`     Subcategory: ${p.subcategory || 'N/A'}`);
      console.log(`     AgeGroup: ${p.ageGroup || 'N/A'}`);
      console.log(`     Color: ${p.enriched_color || 'N/A'}`);
    });
    if (prods.length > 5) {
      console.log(`  ... and ${prods.length - 5} more`);
    }
  });
  
  // Check how many are in Womens-tees
  const womensTees = products.filter(p => p.category.toLowerCase() === 'womens-tees');
  console.log(`\n\nProducts in "Womens-tees" category: ${womensTees.length}`);
  
  if (womensTees.length > 0) {
    console.log('\nWomens-tees products:');
    womensTees.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.title}`);
      console.log(`     ID: ${p.id}`);
      console.log(`     Sleeve: ${p.sleeve || 'N/A'}`);
      console.log(`     AgeGroup: ${p.ageGroup || 'N/A'}`);
      console.log(`     Color: ${p.enriched_color || 'N/A'}`);
      console.log('');
    });
  }
  
  // Check if they match requirements
  console.log('\n================================================================================');
  console.log('REQUIREMENT MATCHING');
  console.log('================================================================================\n');
  
  const requirements = {
    gender: 'female',
    sleeve: 'Long',
    category: 'Womens-tees',
    ageGroup: 'Adult',
  };
  
  let genderMatches = 0;
  let sleeveMatches = 0;
  let categoryMatches = 0;
  let ageGroupMatches = 0;
  let overallMatches = 0;
  
  products.forEach(p => {
    const genderMatch = p.category.toLowerCase().includes('women') || 
                       p.category.toLowerCase().includes('womens');
    const sleeveMatch = p.sleeve && p.sleeve.toLowerCase() === 'long';
    const categoryMatch = p.category.toLowerCase() === 'womens-tees';
    const ageGroupMatch = !p.ageGroup || 
                         p.ageGroup.toLowerCase() === 'adult' ||
                         p.ageGroup.toLowerCase().includes('adult') ||
                         p.category.toLowerCase().includes('women');
    
    if (genderMatch) genderMatches++;
    if (sleeveMatch) sleeveMatches++;
    if (categoryMatch) categoryMatches++;
    if (ageGroupMatch) ageGroupMatches++;
    if (genderMatch && sleeveMatch && categoryMatch && ageGroupMatch) overallMatches++;
  });
  
  console.log(`Total filtered products: ${products.length}`);
  console.log(`Gender Match (Women's): ${genderMatches}/${products.length} (${(genderMatches/products.length*100).toFixed(1)}%)`);
  console.log(`Sleeve Match (Long): ${sleeveMatches}/${products.length} (${(sleeveMatches/products.length*100).toFixed(1)}%)`);
  console.log(`Category Match (Womens-tees): ${categoryMatches}/${products.length} (${(categoryMatches/products.length*100).toFixed(1)}%)`);
  console.log(`Age Group Match (Adult): ${ageGroupMatches}/${products.length} (${(ageGroupMatches/products.length*100).toFixed(1)}%)`);
  console.log(`Overall Match (All criteria): ${overallMatches}/${products.length} (${(overallMatches/products.length*100).toFixed(1)}%)`);
  
  await prisma.$disconnect();
}

checkFilteredProducts().catch(console.error);
