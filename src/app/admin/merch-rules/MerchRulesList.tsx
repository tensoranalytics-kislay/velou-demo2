'use client';

import { useState } from 'react';
import type { MerchRule } from '@prisma/client';

type MerchRuleWithString = Omit<MerchRule, 'ruleType'> & { ruleType: string };

export default function MerchRulesList({ initialRules }: { initialRules: MerchRuleWithString[] }) {
  const [rules, setRules] = useState(initialRules);
  const [showForm, setShowForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleToggleActive = async (id: number, currentActive: boolean) => {
    try {
      const response = await fetch(`/api/admin/merch-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentActive }),
        credentials: 'include', // Include HttpOnly cookies
      });

      if (!response.ok) throw new Error('Failed to update');
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, isActive: !currentActive } : r)),
      );
    } catch (error) {
      console.error('Failed to toggle rule:', error);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;

    try {
      const response = await fetch(`/api/admin/merch-rules/${id}`, {
        method: 'DELETE',
        credentials: 'include', // Include HttpOnly cookies
      });

      if (!response.ok) throw new Error('Failed to delete');
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (error) {
      console.error('Failed to delete rule:', error);
    }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const newRule = {
      ruleType: formData.get('ruleType') as string,
      value: formData.get('value') as string,
      weight: Number(formData.get('weight')),
      isActive: formData.get('isActive') === 'on',
    };

    try {
      const response = await fetch('/api/admin/merch-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRule),
        credentials: 'include', // Include HttpOnly cookies
      });

      if (!response.ok) throw new Error('Failed to create');
      const created = (await response.json()) as MerchRuleWithString;
      setRules((prev) => [created, ...prev]);
      setShowForm(false);
      e.currentTarget.reset();
    } catch (error) {
      console.error('Failed to create rule:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ Add Rule'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-lg border border-slate-200 bg-white p-6">
          <h3 className="mb-4 text-lg font-medium text-slate-900">Create New Rule</h3>
          <div className="space-y-4">
            <div>
              <label htmlFor="ruleType" className="block text-sm font-medium text-slate-700">
                Rule Type
              </label>
              <select
                id="ruleType"
                name="ruleType"
                required
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-blue-500"
              >
                <option value="boost_category">Boost Category</option>
                <option value="exclude_category">Exclude Category</option>
                <option value="hide_out_of_stock">Hide Out of Stock</option>
              </select>
            </div>

            <div>
              <label htmlFor="value" className="block text-sm font-medium text-slate-700">
                Value (e.g., &quot;Dresses&quot;, &quot;Outerwear&quot;)
              </label>
              <input
                type="text"
                id="value"
                name="value"
                required
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="weight" className="block text-sm font-medium text-slate-700">
                Weight (for boost_category, default: 10)
              </label>
              <input
                type="number"
                id="weight"
                name="weight"
                defaultValue={10}
                min="0"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="isActive"
                name="isActive"
                defaultChecked
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="isActive" className="ml-2 text-sm text-slate-700">
                Active
              </label>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Rule'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Value
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Weight
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {rules.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-500">
                  No rules yet. Create one to get started.
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-900">
                    {rule.ruleType.replace('_', ' ')}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-900">{rule.value}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-900">{rule.weight}</td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <button
                      onClick={() => handleToggleActive(rule.id, rule.isActive)}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        rule.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

