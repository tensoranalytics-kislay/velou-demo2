'use client';

import { useState } from 'react';

type MerchantVoice = {
  id: string;
  brandName: string;
  voiceInstructions: string;
  toneFormal: number;
  tonePlayful: number;
};

export default function BrandVoiceForm({ initialData }: { initialData: MerchantVoice }) {
  const [formData, setFormData] = useState({
    brandName: initialData.brandName,
    voiceInstructions: initialData.voiceInstructions,
    toneFormal: initialData.toneFormal,
    tonePlayful: initialData.tonePlayful,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaved(false);

    try {
      const response = await fetch('/api/admin/brand-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
        credentials: 'include', // Include HttpOnly cookies
      });

      if (!response.ok) throw new Error('Failed to save');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save brand config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const previewText = `Hi! I'm ${formData.brandName}'s shopping assistant. ${
    formData.voiceInstructions
  } I'm here to help you find the perfect pieces.`;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="brandName" className="block text-sm font-medium text-slate-700">
          Brand Name
        </label>
        <input
          type="text"
          id="brandName"
          value={formData.brandName}
          onChange={(e) => setFormData({ ...formData, brandName: e.target.value })}
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
        />
      </div>

      <div>
        <label htmlFor="voiceInstructions" className="block text-sm font-medium text-slate-700">
          Voice Instructions
        </label>
        <textarea
          id="voiceInstructions"
          rows={4}
          value={formData.voiceInstructions}
          onChange={(e) => setFormData({ ...formData, voiceInstructions: e.target.value })}
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
          placeholder="Describe how the assistant should communicate..."
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <label htmlFor="toneFormal" className="block text-sm font-medium text-slate-700">
            Formality: {formData.toneFormal}/10
          </label>
          <input
            type="range"
            id="toneFormal"
            min="0"
            max="10"
            value={formData.toneFormal}
            onChange={(e) => setFormData({ ...formData, toneFormal: Number(e.target.value) })}
            className="mt-2 w-full"
          />
          <div className="mt-1 flex justify-between text-xs text-slate-500">
            <span>Casual</span>
            <span>Formal</span>
          </div>
        </div>

        <div>
          <label htmlFor="tonePlayful" className="block text-sm font-medium text-slate-700">
            Playfulness: {formData.tonePlayful}/10
          </label>
          <input
            type="range"
            id="tonePlayful"
            min="0"
            max="10"
            value={formData.tonePlayful}
            onChange={(e) => setFormData({ ...formData, tonePlayful: Number(e.target.value) })}
            className="mt-2 w-full"
          />
          <div className="mt-1 flex justify-between text-xs text-slate-500">
            <span>Serious</span>
            <span>Playful</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="mb-2 text-sm font-medium text-slate-700">Preview</h3>
        <p className="text-sm text-slate-600 italic">{previewText}</p>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
        {saved && <span className="text-sm text-green-600">Saved!</span>}
      </div>
    </form>
  );
}

