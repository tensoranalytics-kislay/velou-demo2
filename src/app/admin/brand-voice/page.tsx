import { prisma } from '@/lib/db';
import BrandVoiceForm from './BrandVoiceForm';

async function getMerchant() {
  const merchant = await prisma.merchant.findUnique({
    where: { slug: 'default' },
  });

  if (!merchant) {
    throw new Error('Default merchant not found. Please run the migration first.');
  }

  return merchant;
}

export default async function BrandVoicePage() {
  const config = await getMerchant();

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

