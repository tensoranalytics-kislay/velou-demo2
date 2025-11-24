import 'dotenv/config';
import { handleAssistantQuery } from '@/lib/llm/orchestrator';

async function main() {
  const queries = [
    'casual like a tshirt, solid coloured',
    'tee for weekend brunch under $80',
    'something like a graphic top, nothing dressy',
  ];

  for (const query of queries) {
    const result = await handleAssistantQuery({
      sessionId: 'debug-session',
      pageType: 'HOME',
      message: query,
    });
    // eslint-disable-next-line no-console
    console.log('Query:', query);
    // eslint-disable-next-line no-console
    console.log('Resolved constraints:', JSON.stringify(result.resolvedConstraints, null, 2));
    // eslint-disable-next-line no-console
    console.log('Intent:', result.intent, 'Used follow-up context:', result.usedFollowUpContext);
    // eslint-disable-next-line no-console
    console.log('---');
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});


