'use client';

import { useState } from 'react';

type MerchantAppearance = {
  id: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor?: string | null;
  surfaceColor?: string | null;
  borderColor?: string | null;
  logoUrl?: string | null;
};

export default function AppearanceForm({ initialData }: { initialData: MerchantAppearance }) {
  const [formData, setFormData] = useState({
    primaryColor: initialData.primaryColor,
    accentColor: initialData.accentColor,
    backgroundColor: initialData.backgroundColor || '#ffffff',
    surfaceColor: initialData.surfaceColor || '#fff7f7',
    borderColor: initialData.borderColor || '#ffe4e6',
    logoUrl: initialData.logoUrl || '',
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaved(false);

    try {
      let logoUrl = formData.logoUrl;

      if (logoFile) {
        const fd = new FormData();
        fd.append('file', logoFile);
        const uploadRes = await fetch('/api/admin/brand-logo', {
          method: 'POST',
          body: fd,
          credentials: 'include', // Include HttpOnly cookies
        });
        if (!uploadRes.ok) {
          throw new Error('Failed to upload logo');
        }
        const uploadJson = (await uploadRes.json()) as { logoUrl?: string };
        if (uploadJson.logoUrl) {
          logoUrl = uploadJson.logoUrl;
        }
      }

      const response = await fetch('/api/admin/brand-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include HttpOnly cookies
        body: JSON.stringify({
          primaryColor: formData.primaryColor,
          accentColor: formData.accentColor,
          backgroundColor: formData.backgroundColor,
          surfaceColor: formData.surfaceColor,
          borderColor: formData.borderColor,
          logoUrl: logoUrl || null,
        }),
      });

      if (!response.ok) throw new Error('Failed to save');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save appearance config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">Brand logo</h3>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-32 items-center justify-center rounded-md border border-slate-200 bg-white">
            {formData.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={formData.logoUrl}
                alt="Brand logo preview"
                className="max-h-12 max-w-full object-contain"
              />
            ) : (
              <span className="text-xs text-slate-400">No logo uploaded</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="logo"
              className="inline-flex cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <span>Upload logo</span>
              <input
                id="logo"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setLogoFile(file);
                  if (file) {
                    const url = URL.createObjectURL(file);
                    setFormData((prev) => ({ ...prev, logoUrl: url }));
                  }
                }}
              />
            </label>
            <p className="text-xs text-slate-500">
              Upload a square or horizontal logo (PNG, JPG, or SVG). It will be used in the site header.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="primaryColor" className="block text-sm font-medium text-slate-700">
            Primary color (buttons, highlights)
          </label>
          <div className="mt-2 flex gap-4">
            <input
              type="color"
              id="primaryColor"
              value={formData.primaryColor}
              onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
              className="h-8 w-16 cursor-pointer rounded-lg border border-slate-300"
            />
            <input
              type="text"
              value={formData.primaryColor}
              onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
              placeholder="#e11d48"
            />
          </div>
        </div>

        <div>
          <label htmlFor="accentColor" className="block text-sm font-medium text-slate-700">
            Accent color (chips, subtle highlights)
          </label>
          <div className="mt-2 flex gap-4">
            <input
              type="color"
              id="accentColor"
              value={formData.accentColor}
              onChange={(e) => setFormData({ ...formData, accentColor: e.target.value })}
              className="h-8 w-16 cursor-pointer rounded-lg border border-slate-300"
            />
            <input
              type="text"
              value={formData.accentColor}
              onChange={(e) => setFormData({ ...formData, accentColor: e.target.value })}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
              placeholder="#f97373"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <label htmlFor="backgroundColor" className="block text-sm font-medium text-slate-700">
            Page background
          </label>
          <div className="mt-2 flex gap-4">
            <input
              type="color"
              id="backgroundColor"
              value={formData.backgroundColor}
              onChange={(e) => setFormData({ ...formData, backgroundColor: e.target.value })}
              className="h-8 w-16 cursor-pointer rounded-lg border border-slate-300"
            />
            <input
              type="text"
              value={formData.backgroundColor}
              onChange={(e) => setFormData({ ...formData, backgroundColor: e.target.value })}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
              placeholder="#ffffff"
            />
          </div>
        </div>
        <div>
          <label htmlFor="surfaceColor" className="block text-sm font-medium text-slate-700">
            Card & chat background
          </label>
          <div className="mt-2 flex gap-4">
            <input
              type="color"
              id="surfaceColor"
              value={formData.surfaceColor}
              onChange={(e) => setFormData({ ...formData, surfaceColor: e.target.value })}
              className="h-8 w-16 cursor-pointer rounded-lg border border-slate-300"
            />
            <input
              type="text"
              value={formData.surfaceColor}
              onChange={(e) => setFormData({ ...formData, surfaceColor: e.target.value })}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
              placeholder="#fff7f7"
            />
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="borderColor" className="block text-sm font-medium text-slate-700">
          Border color
        </label>
        <div className="mt-2 flex gap-4">
          <input
            type="color"
            id="borderColor"
            value={formData.borderColor}
            onChange={(e) => setFormData({ ...formData, borderColor: e.target.value })}
            className="h-8 w-16 cursor-pointer rounded-lg border border-slate-300"
          />
          <input
            type="text"
            value={formData.borderColor}
            onChange={(e) => setFormData({ ...formData, borderColor: e.target.value })}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
            placeholder="#ffe4e6"
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="mb-2 text-sm font-medium text-slate-700">Preview</h3>
        <div className="flex gap-2">
          <div
            className="h-12 flex-1 rounded-lg"
            style={{ backgroundColor: formData.primaryColor }}
          />
          <div
            className="h-12 flex-1 rounded-lg"
            style={{ backgroundColor: formData.accentColor }}
          />
          <div
            className="hidden h-12 flex-1 rounded-lg md:block"
            style={{ backgroundColor: formData.surfaceColor }}
          />
        </div>
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


