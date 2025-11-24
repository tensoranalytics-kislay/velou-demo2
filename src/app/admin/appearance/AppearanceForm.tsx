'use client';

import { useState } from 'react';

type BrandConfig = {
  id: number;
  primaryColor: string;
  accentColor: string;
};

export default function AppearanceForm({ initialData }: { initialData: BrandConfig }) {
  const [formData, setFormData] = useState({
    primaryColor: initialData.primaryColor,
    accentColor: initialData.accentColor,
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
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="primaryColor" className="block text-sm font-medium text-slate-700">
          Primary Color
        </label>
        <div className="mt-2 flex gap-4">
          <input
            type="color"
            id="primaryColor"
            value={formData.primaryColor}
            onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
            className="h-12 w-24 cursor-pointer rounded-lg border border-slate-300"
          />
          <input
            type="text"
            value={formData.primaryColor}
            onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
            placeholder="#3b82f6"
          />
        </div>
      </div>

      <div>
        <label htmlFor="accentColor" className="block text-sm font-medium text-slate-700">
          Accent Color
        </label>
        <div className="mt-2 flex gap-4">
          <input
            type="color"
            id="accentColor"
            value={formData.accentColor}
            onChange={(e) => setFormData({ ...formData, accentColor: e.target.value })}
            className="h-12 w-24 cursor-pointer rounded-lg border border-slate-300"
          />
          <input
            type="text"
            value={formData.accentColor}
            onChange={(e) => setFormData({ ...formData, accentColor: e.target.value })}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
            placeholder="#8b5cf6"
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

