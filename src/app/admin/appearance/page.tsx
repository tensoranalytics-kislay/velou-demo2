import { prisma } from '@/lib/db';
import AppearanceForm from './AppearanceForm';

async function getBrandConfig() {
  let config = await prisma.brandConfig.findUnique({ where: { id: 1 } });
  if (!config) {
    config = await prisma.brandConfig.create({
      data: {
        id: 1,
        brandName: 'Velou Atelier',
        primaryColor: '#3b82f6',
        accentColor: '#8b5cf6',
        voiceInstructions: 'Be helpful and warm.',
        toneFormal: 5,
        tonePlayful: 5,
      },
    });
  }
  return config;
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

