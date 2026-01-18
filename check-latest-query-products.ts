import { prisma } from './src/lib/db';

async function checkLatestQueryProducts() {
  // Latest query: "dresses that go well with Dr. Martens high top chelsea shoes"
  const productIds = [
    '8105247277241', // Sandara Cotton Pinstripe Midi Dress for Women in Sky Lagoon
    '8271017279673', // Krista Lace-Trimmed Cotton Mini Dress for Women in Orchid Ice
    '7950165573817', // Docila Upcycled Floral Cotton Mini Dress for Women in Cream Pink
    '8047658172601'  // Meva Tweed Lace-Trimmed Mini Dress for Women in Strawberry Spritz
  ];

  const constraints = {
    styles: ['Casual', 'Modern', 'Bohemian', 'Romantic'],
    occasions: ['Daytime'],
    materials: ['Cotton', 'Denim'],
    seasons: ['Spring', 'Summer', 'Fall'],
    fits: ['Regular', 'Relaxed'],
    lengths: ['Mini', 'Midi'],
    necklines: ['Round', 'Scoop', 'Square'],
    sleeveLengths: ['Short', 'Sleeveless'],
    ageGroups: ['Adult']
  };

  console.log('='.repeat(80));
  console.log('LATEST QUERY CONSTRAINT MATCHING VERIFICATION');
  console.log('='.repeat(80));
  console.log(`\nQuery: "dresses that go well with Dr. Martens high top chelsea shoes"`);
  console.log(`\nGenerated Constraints:`);
  console.log(`  Styles: ${constraints.styles.join(', ')} (intent: strong)`);
  console.log(`  Occasions: ${constraints.occasions.join(', ')} (intent: strong)`);
  console.log(`  Materials: ${constraints.materials.join(', ')} (intent: strong)`);
  console.log(`  Seasons: ${constraints.seasons.join(', ')} (intent: strong)`);
  console.log(`  Fits: ${constraints.fits.join(', ')} (intent: strong)`);
  console.log(`  Lengths: ${constraints.lengths.join(', ')} (intent: strong)`);
  console.log(`  Necklines: ${constraints.necklines.join(', ')} (intent: strong)`);
  console.log(`  SleeveLengths: ${constraints.sleeveLengths.join(', ')} (intent: strong)`);
  console.log(`  Age Groups: ${constraints.ageGroups.join(', ')} (intent: strong)`);
  console.log('\n' + '='.repeat(80) + '\n');

  for (const productId of productIds) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        title: true,
        silhouetteCut: true,
        fit: true,
        ageGroup: true,
        length: true,
        sleeve: true,
        neckline: true,
        material: true,
        fabric: true,
        occasion: true,
        occasionContext: true,
        season: true,
        attributes: true,
      }
    });

    if (!product) {
      console.log(`❌ Product ${productId} NOT FOUND\n`);
      continue;
    }

    const attrs = product.attributes as any;
    const styleLabels = attrs?.style_labels || attrs?.styleLabels || null;
    const styleAttr = attrs?.style || attrs?.Style || null;
    const fitAttr = attrs?.fit || attrs?.Fit || null;

    console.log(`📦 Product: ${product.title}`);
    console.log(`   ID: ${product.id}`);
    console.log(`\n   Column Values:`);
    console.log(`     silhouetteCut: ${product.silhouetteCut || 'NULL'}`);
    console.log(`     length: ${product.length || 'NULL'}`);
    console.log(`     sleeve: ${product.sleeve || 'NULL'}`);
    console.log(`     neckline: ${product.neckline || 'NULL'}`);
    console.log(`     fit: ${product.fit || 'NULL'}`);
    console.log(`     material: ${product.material || 'NULL'}`);
    console.log(`     fabric: ${product.fabric || 'NULL'}`);
    console.log(`     occasion: ${product.occasion || 'NULL'}`);
    console.log(`     occasionContext: ${Array.isArray(product.occasionContext) ? product.occasionContext.join(', ') : product.occasionContext || 'NULL'}`);
    console.log(`     season: ${product.season || 'NULL'}`);
    console.log(`     ageGroup: ${product.ageGroup || 'NULL'}`);

    // Check matches
    const matches: Record<string, { matched: string[]; total: number }> = {};

    // Check styles
    const allStyles = [
      product.silhouetteCut,
      ...(Array.isArray(styleLabels) ? styleLabels : styleLabels ? [styleLabels] : []),
      ...(Array.isArray(styleAttr) ? styleAttr : styleAttr ? [styleAttr] : [])
    ].filter(Boolean).map(s => String(s).toLowerCase().trim());
    
    matches.styles = {
      matched: constraints.styles.filter(s => allStyles.some(ps => 
        ps === s.toLowerCase() || ps.includes(s.toLowerCase()) || s.toLowerCase().includes(ps)
      )),
      total: constraints.styles.length
    };

    // Check lengths
    const lengthValue = (product.length || '').toLowerCase().trim();
    matches.lengths = {
      matched: constraints.lengths.filter(l => lengthValue === l.toLowerCase() || lengthValue.includes(l.toLowerCase())),
      total: constraints.lengths.length
    };

    // Check sleeveLengths
    const sleeveValue = (product.sleeve || '').toLowerCase().trim();
    matches.sleeveLengths = {
      matched: constraints.sleeveLengths.filter(s => 
        sleeveValue === s.toLowerCase() || 
        (s.toLowerCase() === 'sleeveless' && sleeveValue.includes('sleeveless'))
      ),
      total: constraints.sleeveLengths.length
    };

    // Check necklines
    const necklineValue = (product.neckline || '').toLowerCase().trim();
    matches.necklines = {
      matched: constraints.necklines.filter(n => necklineValue === n.toLowerCase() || necklineValue.includes(n.toLowerCase())),
      total: constraints.necklines.length
    };

    // Check fits
    const allFits = [product.fit, ...(Array.isArray(fitAttr) ? fitAttr : fitAttr ? [fitAttr] : [])]
      .filter(Boolean).map(f => String(f).toLowerCase().trim());
    matches.fits = {
      matched: constraints.fits.filter(f => allFits.some(pf => pf === f.toLowerCase() || pf.includes(f.toLowerCase()))),
      total: constraints.fits.length
    };

    // Check materials
    const allMaterials = [product.material, product.fabric].filter(Boolean).map(m => String(m).toLowerCase().trim());
    matches.materials = {
      matched: constraints.materials.filter(m => allMaterials.some(pm => 
        pm === m.toLowerCase() || pm.includes(m.toLowerCase()) || m.toLowerCase().includes(pm)
      )),
      total: constraints.materials.length
    };

    // Check occasions
    const occasionValues = [
      product.occasion,
      ...(Array.isArray(product.occasionContext) ? product.occasionContext : product.occasionContext ? [product.occasionContext] : [])
    ].filter(Boolean).map(o => String(o).toLowerCase().trim());
    matches.occasions = {
      matched: constraints.occasions.filter(o => occasionValues.some(po => 
        po === o.toLowerCase() || po.includes(o.toLowerCase()) || o.toLowerCase().includes(po)
      )),
      total: constraints.occasions.length
    };

    // Check seasons
    const seasonValue = (product.season || '').toLowerCase().trim();
    matches.seasons = {
      matched: constraints.seasons.filter(s => seasonValue.includes(s.toLowerCase()) || s.toLowerCase().includes(seasonValue)),
      total: constraints.seasons.length
    };

    // Check ageGroups
    const ageGroupValue = (product.ageGroup || '').toLowerCase().trim();
    matches.ageGroups = {
      matched: constraints.ageGroups.filter(ag => ageGroupValue === ag.toLowerCase() || ageGroupValue.includes(ag.toLowerCase())),
      total: constraints.ageGroups.length
    };

    console.log(`\n   ✅ Constraint Matches:`);
    for (const [key, { matched, total }] of Object.entries(matches)) {
      const matchStr = matched.length > 0 ? matched.join(', ') : 'NONE';
      const percentage = total > 0 ? ((matched.length / total) * 100).toFixed(0) : '0';
      console.log(`     ${key}: ${matchStr} (${matched.length}/${total} = ${percentage}%)`);
    }

    // Calculate overall match score (weighted by constraint importance)
    const totalMatches = Object.values(matches).reduce((sum, m) => sum + m.matched.length, 0);
    const totalConstraints = Object.values(matches).reduce((sum, m) => sum + m.total, 0);
    const matchScore = totalConstraints > 0 ? (totalMatches / totalConstraints) * 100 : 0;

    console.log(`\n   📊 Overall Match Score: ${matchScore.toFixed(1)}% (${totalMatches}/${totalConstraints} constraints matched)`);
    console.log('\n' + '-'.repeat(80) + '\n');
  }

  await prisma.$disconnect();
}

checkLatestQueryProducts().catch(console.error);
