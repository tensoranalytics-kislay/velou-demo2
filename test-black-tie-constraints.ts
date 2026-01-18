import { classifyQuery } from './src/lib/loveshackfancy/classifier';
import { logger } from './src/lib/telemetry/logger';

async function testBlackTieQuery() {
  console.log('='.repeat(80));
  console.log('Testing: "attending a black tie wedding, suggest me a dress"');
  console.log('='.repeat(80));
  console.log();

  const query = "attending a black tie wedding, suggest me a dress";
  
  try {
    const classification = await classifyQuery({
      message: query,
      isFollowUp: false,
      merchantId: 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
    });

    console.log('📊 Classification Results:');
    console.log(`  Type: ${classification.type}`);
    console.log(`  Confidence: ${classification.confidence}`);
    console.log(`  Product Terms: ${classification.productTerms}`);
    console.log();

    console.log('🔍 Extracted Constraints (with intents):');
    const constraints = classification.constraints;
    
    Object.entries(constraints).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      
      const intent = (value as any).intent;
      const values = (value as any).values || value;
      
      if (intent) {
        const marker = intent === 'required' ? '🔴 HARD FILTER' : intent === 'strong' ? '🟡 SOFT FILTER' : '🟢 PREFERRED';
        console.log(`  ${marker} ${key}: ${JSON.stringify(values)} (intent: ${intent})`);
      } else if (Array.isArray(value)) {
        console.log(`  ⚪ ARRAY ${key}: ${JSON.stringify(value)} (no intent specified)`);
      } else {
        console.log(`  ⚪ ${key}: ${JSON.stringify(value)}`);
      }
    });
    
    console.log();
    
    // Count required vs soft
    const requiredConstraints: string[] = [];
    const softConstraints: string[] = [];
    const preferredConstraints: string[] = [];
    
    Object.entries(constraints).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      const intent = (value as any).intent;
      
      if (intent === 'required') {
        requiredConstraints.push(key);
      } else if (intent === 'strong') {
        softConstraints.push(key);
      } else if (intent === 'preferred') {
        preferredConstraints.push(key);
      }
    });
    
    console.log('📈 Constraint Intent Summary:');
    console.log(`  🔴 Required (Hard Filters): ${requiredConstraints.length} - ${requiredConstraints.join(', ') || 'none'}`);
    console.log(`  🟡 Strong (Soft Filters): ${softConstraints.length} - ${softConstraints.join(', ') || 'none'}`);
    console.log(`  🟢 Preferred: ${preferredConstraints.length} - ${preferredConstraints.join(', ') || 'none'}`);
    console.log();

    // Show what will be used as hard SQL filters
    console.log('🚨 These will be applied as HARD SQL FILTERS:');
    requiredConstraints.forEach(key => {
      const value = constraints[key as keyof typeof constraints];
      const values = (value as any).values || value;
      console.log(`  - ${key}: ${JSON.stringify(values)}`);
    });
    
    if (requiredConstraints.length === 0) {
      console.log('  (none)');
    }
    console.log();

  } catch (error) {
    console.error('❌ Error:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  } finally {
    process.exit(0);
  }
}

testBlackTieQuery();
