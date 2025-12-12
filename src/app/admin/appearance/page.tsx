import { prisma } from '@/lib/db';
import AppearanceForm from './AppearanceForm';

async function getMerchant() {
  // Get the default merchant (created during migration)
  const merchant = await prisma.merchant.findUnique({
    where: { slug: 'default' },
  });

  if (!merchant) {
    throw new Error('Default merchant not found. Please run the migration first.');
  }

  return merchant;
}

export default async function AppearancePage() {
  const config = await getMerchant();

  return (
    <div className="max-w-3xl">
      <h2 className="mb-6 text-2xl font-semibold text-slate-900">Appearance</h2>
      <p className="mb-8 text-slate-600">
        Customize the visual theme colors for your shopping assistant interface.
      </p>
      <AppearanceForm initialData={config} />
    </div>
  );
}

