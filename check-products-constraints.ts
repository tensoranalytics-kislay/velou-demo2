import { prisma } from './src/lib/db';

async function checkProducts() {
  const productIds = [
    '8244347928761',
    '8244346880185',
    '8244348158137',
    '8084019216569'
  ];

  const constraints = {
    styles: ['A-Line', 'Wrap', 'Fit and Flare', 'Empire'],
    fits: ['Fitted', 'Relaxed', 'Loose', 'Regular'],
    ageGroups: ['Adult']
  };

  console.log('='.repeat(80));
  console.log('CONSTRAINT MATCHING VERIFICATION');
  console.log('='.repeat(80));
  console.log(`\nGenerated Constraints:`);
  console.log(`  Styles: ${constraints.styles.join(', ')}`);
  console.log(`  Fits: ${constraints.fits.join(', ')}`);
  console.log(`  Age Groups: ${constraints.ageGroups.join(', ')}`);
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
    console.log(`     fit: ${product.fit || 'NULL'}`);
    console.log(`     ageGroup: ${product.ageGroup || 'NULL'}`);
    console.log(`\n   Attribute Values (JSONB):`);
    console.log(`     attributes.style_labels: ${Array.isArray(styleLabels) ? styleLabels.join(', ') : styleLabels || 'NULL'}`);
    console.log(`     attributes.style: ${Array.isArray(styleAttr) ? styleAttr.join(', ') : styleAttr || 'NULL'}`);
    console.log(`     attributes.fit: ${Array.isArray(fitAttr) ? fitAttr.join(', ') : fitAttr || 'NULL'}`);

    // Check matches
    const styleMatches: string[] = [];
    const fitMatches: string[] = [];
    const ageGroupMatches: string[] = [];

    // Check styles - check silhouetteCut first (primary source), then style_labels, then style
    const allStyles = [
      product.silhouetteCut,
      ...(Array.isArray(styleLabels) ? styleLabels : styleLabels ? [styleLabels] : []),
      ...(Array.isArray(styleAttr) ? styleAttr : styleAttr ? [styleAttr] : [])
    ].filter(Boolean).map(s => String(s).toLowerCase().trim());

    for (const constraintStyle of constraints.styles) {
      const constraintLower = constraintStyle.toLowerCase().trim();
      if (allStyles.some(s => 
        s === constraintLower || 
        s.includes(constraintLower) || 
        constraintLower.includes(s) ||
        s.replace(/[-\s]/g, '') === constraintLower.replace(/[-\s]/g, '')
      )) {
        styleMatches.push(constraintStyle);
      }
    }

    // Check fits - check fit column first (primary source), then fit attribute
    const allFits = [
      product.fit,
      ...(Array.isArray(fitAttr) ? fitAttr : fitAttr ? [fitAttr] : [])
    ].filter(Boolean).map(f => String(f).toLowerCase().trim());

    for (const constraintFit of constraints.fits) {
      const constraintLower = constraintFit.toLowerCase().trim();
      if (allFits.some(f => 
        f === constraintLower || 
        f.includes(constraintLower) || 
        constraintLower.includes(f)
      )) {
        fitMatches.push(constraintFit);
      }
    }

    // Check age groups
    const ageGroupValue = (product.ageGroup || '').toLowerCase().trim();
    if (constraints.ageGroups.some(ag => 
      ageGroupValue === ag.toLowerCase() || 
      ageGroupValue.includes(ag.toLowerCase()) || 
      ag.toLowerCase().includes(ageGroupValue)
    )) {
      ageGroupMatches.push(...constraints.ageGroups.filter(ag => 
        ageGroupValue === ag.toLowerCase() || 
        ageGroupValue.includes(ag.toLowerCase()) || 
        ag.toLowerCase().includes(ageGroupValue)
      ));
    }

    console.log(`\n   ✅ Matches:`);
    console.log(`     Styles: ${styleMatches.length > 0 ? styleMatches.join(', ') : 'NONE'} (${styleMatches.length}/${constraints.styles.length})`);
    console.log(`     Fits: ${fitMatches.length > 0 ? fitMatches.join(', ') : 'NONE'} (${fitMatches.length}/${constraints.fits.length})`);
    console.log(`     Age Groups: ${ageGroupMatches.length > 0 ? ageGroupMatches.join(', ') : 'NONE'} (${ageGroupMatches.length}/${constraints.ageGroups.length})`);
    
    const matchScore = (
      (styleMatches.length / constraints.styles.length) * 0.4 +
      (fitMatches.length / constraints.fits.length) * 0.4 +
      (ageGroupMatches.length / constraints.ageGroups.length) * 0.2
    ) * 100;

    console.log(`\n   📊 Overall Match Score: ${matchScore.toFixed(1)}%`);
    console.log('\n' + '-'.repeat(80) + '\n');
  }

  await prisma.$disconnect();
}

checkProducts().catch(console.error);
