import { handleAssistantQuery } from './src/lib/services/AssistantService';
import { prisma } from './src/lib/db';
import { getState } from './src/lib/chat/ConversationStateService';

async function diagnoseEnhancedQuery() {
  console.log('='.repeat(80));
  console.log('DIAGNOSING: Enhanced Query Flow');
  console.log('='.repeat(80));

  const sessionId = `diagnose-${Date.now()}`;
  const queries = [
    'red dresses',
    'change to navy',
    'cotton instead',
    'mini instead',
    'size 6 instead',
  ];

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    console.log(`\n${'-'.repeat(80)}`);
    console.log(`Step ${i + 1}: "${query}"`);
    console.log(`${'-'.repeat(80)}`);

    // Get state BEFORE the query
    const stateBefore = await getState(
      'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
      sessionId
    );
    console.log(`\n📋 State BEFORE query:`);
    console.log(`   lastEnhancedQuery: ${stateBefore.memory?.lastEnhancedQuery || 'null'}`);
    console.log(`   lastCategories: ${JSON.stringify(stateBefore.memory?.lastCategories || [])}`);

    const result = await handleAssistantQuery(
      'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
      {
        message: query,
        sessionId,
        conversationContext: stateBefore ? { lastEnhancedQuery: stateBefore.memory?.lastEnhancedQuery } : undefined, // Pass the state we just read
      }
    );

    // Get state AFTER the query (wait a bit for async updateState to complete)
    await new Promise(resolve => setTimeout(resolve, 100));
    const stateAfter = await getState(
      'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b',
      sessionId
    );
    console.log(`\n📋 State AFTER query:`);
    console.log(`   lastEnhancedQuery: ${stateAfter.memory?.lastEnhancedQuery || 'null'}`);
    console.log(`   lastCategories: ${JSON.stringify(stateAfter.memory?.lastCategories || [])}`);

    console.log(`\n📦 Products: ${result.productCards?.length || 0}`);
    console.log(`\n🔍 Resolved Constraints:`);
    if (result.resolvedConstraints) {
      const c = result.resolvedConstraints;
      if (c.colors) console.log(`   colors: ${JSON.stringify(c.colors)}`);
      if (c.materials) console.log(`   materials: ${JSON.stringify(c.materials)}`);
      if (c.lengths) console.log(`   lengths: ${JSON.stringify(c.lengths)}`);
      if (c.sizes) console.log(`   sizes: ${JSON.stringify(c.sizes)}`);
    }
  }

  await prisma.$disconnect();
}

diagnoseEnhancedQuery()
  .then(() => {
    console.log('\n✅ Diagnosis complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Diagnosis failed:', error);
    process.exit(1);
  });
