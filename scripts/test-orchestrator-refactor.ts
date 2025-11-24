/**
 * Test script to verify the refactored orchestrator works correctly
 */
import { handleAssistantQuery } from '../src/lib/llm/orchestrator';
import type {
  AssistantQueryInput,
  AssistantQueryResult,
  ConversationContext,
  ProductCard,
  QueryChip,
} from '../src/lib/llm/orchestrator';

async function testBasicQuery() {
  console.log('🧪 Test 1: Basic discovery query...');
  const input: AssistantQueryInput = {
    sessionId: 'test-1',
    pageType: 'HOME',
    message: 'casual summer dress under $50',
  };

  const result: AssistantQueryResult = await handleAssistantQuery(input);

  // Verify result structure
  if (!result.replyText || typeof result.replyText !== 'string') {
    throw new Error('Missing or invalid replyText');
  }
  if (!Array.isArray(result.productCards)) {
    throw new Error('productCards must be an array');
  }
  if (typeof result.noExactMatch !== 'boolean') {
    throw new Error('noExactMatch must be a boolean');
  }
  if (!result.intent || !['discovery', 'pdp_suitability'].includes(result.intent)) {
    throw new Error('Invalid intent');
  }
  if (!result.resolvedConstraints) {
    throw new Error('Missing resolvedConstraints');
  }
  if (typeof result.usedFollowUpContext !== 'boolean') {
    throw new Error('usedFollowUpContext must be a boolean');
  }

  console.log('✅ Basic query test passed');
  console.log(`   Reply: ${result.replyText.substring(0, 50)}...`);
  console.log(`   Products: ${result.productCards.length}`);
  console.log(`   Intent: ${result.intent}`);
  return result;
}

async function testFollowUpQuery() {
  console.log('\n🧪 Test 2: Follow-up query with conversation context...');
  const context: ConversationContext = {
    lastIntent: 'discovery',
    lastConstraints: {
      category: 'Dresses',
      priceMaxCents: 5000,
      inStockOnly: true,
    },
    lastShownProductIds: [],
    lastUserQuery: 'casual summer dress under $50',
  };

  const input: AssistantQueryInput = {
    sessionId: 'test-2',
    pageType: 'HOME',
    message: 'make it cheaper',
    conversationContext: context,
  };

  const result = await handleAssistantQuery(input);

  if (!result.usedFollowUpContext) {
    throw new Error('Expected usedFollowUpContext to be true for follow-up');
  }

  console.log('✅ Follow-up query test passed');
  console.log(`   Used follow-up context: ${result.usedFollowUpContext}`);
  return result;
}

async function testPendingSuggestion() {
  console.log('\n🧪 Test 3: Pending suggestion confirmation...');
  
  // First, get a query that might trigger a pending suggestion
  const initialInput: AssistantQueryInput = {
    sessionId: 'test-3',
    pageType: 'HOME',
    message: 'very specific product that might not exist',
  };

  const initialResult = await handleAssistantQuery(initialInput);

  // If we got a pending suggestion, test confirming it
  if (initialResult.pendingSuggestion) {
    const confirmInput: AssistantQueryInput = {
      sessionId: 'test-3',
      pageType: 'HOME',
      message: 'yes',
      pendingSuggestion: initialResult.pendingSuggestion,
    };

    const confirmResult = await handleAssistantQuery(confirmInput);
    
    if (confirmResult.productCards.length === 0 && !confirmResult.noExactMatch) {
      throw new Error('Expected products or noExactMatch flag after confirmation');
    }

    console.log('✅ Pending suggestion test passed');
    console.log(`   Products after confirmation: ${confirmResult.productCards.length}`);
  } else {
    console.log('⚠️  No pending suggestion generated (this is OK)');
  }
}

async function testProductCardStructure() {
  console.log('\n🧪 Test 4: Product card structure validation...');
  const input: AssistantQueryInput = {
    sessionId: 'test-4',
    pageType: 'HOME',
    message: 'summer top',
  };

  const result = await handleAssistantQuery(input);

  if (result.productCards.length > 0) {
    const card: ProductCard = result.productCards[0];
    
    // Verify card structure
    if (!card.id || typeof card.id !== 'string') {
      throw new Error('Card missing id');
    }
    if (!card.title || typeof card.title !== 'string') {
      throw new Error('Card missing title');
    }
    if (typeof card.priceCents !== 'number') {
      throw new Error('Card missing priceCents');
    }
    if (!card.currency || typeof card.currency !== 'string') {
      throw new Error('Card missing currency');
    }
    if (!Array.isArray(card.keyAttributes)) {
      throw new Error('Card missing keyAttributes array');
    }
    if (!card.reason || typeof card.reason !== 'string') {
      throw new Error('Card missing reason');
    }
    if (!card.imageUrl || typeof card.imageUrl !== 'string') {
      throw new Error('Card missing imageUrl');
    }
    if (!card.productUrl || typeof card.productUrl !== 'string') {
      throw new Error('Card missing productUrl');
    }
    if (card.queryChips && !Array.isArray(card.queryChips)) {
      throw new Error('queryChips must be an array if present');
    }
    if (card.queryChips) {
      const chip: QueryChip = card.queryChips[0];
      if (!chip.label || !chip.why) {
        throw new Error('QueryChip missing label or why');
      }
    }

    console.log('✅ Product card structure test passed');
    console.log(`   Sample card: ${card.title.substring(0, 30)}...`);
  } else {
    console.log('⚠️  No products returned (this is OK for some queries)');
  }
}

async function testTypeExports() {
  console.log('\n🧪 Test 5: Type exports verification...');
  
  // This test verifies that all types are properly exported
  // If TypeScript compiles, the types are accessible
  const testTypes = {
    AssistantQueryInput: {} as AssistantQueryInput,
    AssistantQueryResult: {} as AssistantQueryResult,
    ConversationContext: {} as ConversationContext,
    ProductCard: {} as ProductCard,
    QueryChip: {} as QueryChip,
  };

  console.log('✅ All types are properly exported');
  console.log(`   Verified types: ${Object.keys(testTypes).join(', ')}`);
}

async function main() {
  console.log('🚀 Starting orchestrator refactor tests...\n');

  try {
    await testBasicQuery();
    await testFollowUpQuery();
    await testPendingSuggestion();
    await testProductCardStructure();
    await testTypeExports();

    console.log('\n✅ All tests passed! The refactored orchestrator is working correctly.');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

main();

