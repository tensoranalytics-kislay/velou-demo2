import { prisma } from '@/lib/db';
import BrandVoiceForm from './BrandVoiceForm';

async function getBrandConfig() {
  return prisma.brandConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      brandName: 'Velou Atelier',
      primaryColor: '#3b82f6',
      accentColor: '#8b5cf6',
      voiceInstructions:
        'Be helpful, warm, and knowledgeable about fashion. Use a conversational tone that feels like a personal stylist.',
      toneFormal: 5,
      tonePlayful: 5,
    },
  });
}

export default async function BrandVoicePage() {
  const config = await getBrandConfig();

  return (
    <div className="max-w-3xl">
      <h2 className="mb-6 text-2xl font-semibold text-slate-900">Brand Voice</h2>
      <p className="mb-8 text-slate-600">
        Configure how your shopping assistant communicates with customers. These settings influence the tone and style
        of AI-generated responses.
      </p>
      <BrandVoiceForm initialData={config} />
    </div>
  );
}

