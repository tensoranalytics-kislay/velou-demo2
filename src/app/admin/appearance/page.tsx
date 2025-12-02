import { prisma } from '@/lib/db';
import AppearanceForm from './AppearanceForm';

// Force dynamic rendering to avoid build-time database queries
export const dynamic = 'force-dynamic';

async function getBrandConfig() {
  return prisma.brandConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      brandName: 'Velou Atelier',
      primaryColor: '#3b82f6',
      accentColor: '#8b5cf6',
      backgroundColor: '#ffffff',
      surfaceColor: '#fff7f7',
      borderColor: '#ffe4e6',
      voiceInstructions: 'Be helpful and warm.',
      toneFormal: 5,
      tonePlayful: 5,
      // Explicitly provide timestamps to satisfy BrandConfigCreateInput
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // Explicitly select only fields that exist in the schema
    select: {
      id: true,
      brandName: true,
      primaryColor: true,
      accentColor: true,
      backgroundColor: true,
      surfaceColor: true,
      borderColor: true,
      logoUrl: true,
      voiceInstructions: true,
      toneFormal: true,
      tonePlayful: true,
      useMerchantKey: true,
      merchantOpenAIKey: true,
      createdAt: true,
      updatedAt: true,
      datasetContext: true,
    },
  });
}

export default async function AppearancePage() {
  const config = await getBrandConfig();

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

