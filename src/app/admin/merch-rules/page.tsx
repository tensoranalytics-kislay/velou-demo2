import { prisma } from '@/lib/db';
import MerchRulesList from './MerchRulesList';

// Force dynamic rendering to avoid build-time database queries
export const dynamic = 'force-dynamic';

async function getMerchRules() {
  return prisma.merchRule.findMany({
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
  });
}

export default async function MerchRulesPage() {
  const rules = await getMerchRules();

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Merchandising Rules</h2>
          <p className="mt-2 text-slate-600">
            Control how products are prioritized and filtered in search results.
          </p>
        </div>
      </div>
      <MerchRulesList initialRules={rules} />
    </div>
  );
}

