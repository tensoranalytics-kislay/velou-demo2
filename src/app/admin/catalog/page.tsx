'use client';

import { useState } from 'react';
import type { IngestionSummary } from '@/lib/catalog/ingestUnifiedCsv';

export default function CatalogUploadPage() {
  const [vendorId, setVendorId] = useState('default-vendor');
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [summary, setSummary] = useState<IngestionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv')) {
        setError('Please select a CSV file');
        return;
      }
      setFile(selectedFile);
      setError(null);
      setSummary(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a CSV file');
      return;
    }

    setIsUploading(true);
    setError(null);
    setSummary(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('vendorId', vendorId);
      formData.append('enableContextInference', 'true');

      const response = await fetch('/api/admin/catalog/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(errorData.error || errorData.message || 'Upload failed');
      }

      const data = await response.json();
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload catalog');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-slate-900">Catalog Upload</h2>
        <p className="mt-2 text-slate-600">
          Upload a unified catalog CSV to import products into the system.
        </p>
      </div>

      {/* Info Box */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h3 className="mb-2 text-sm font-medium text-blue-900">Required vs Optional Fields</h3>
        <p className="text-sm text-blue-800">
          We only require a stable <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs">product_id</code>, a{' '}
          <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs">title</code> or{' '}
          <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs">short_title</code>, and a{' '}
          <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-xs">product_url</code> per row. All other fields
          are optional but improve search and recommendations. The assistant can still work with sparse data, but queries
          involving missing fields (e.g., price, materials) will be limited.
        </p>
      </div>

      {/* Upload Form */}
      {!summary && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="space-y-6">
            <div>
              <label htmlFor="vendorId" className="block text-sm font-medium text-slate-700">
                Vendor ID
              </label>
              <input
                type="text"
                id="vendorId"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                required
                className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                placeholder="default-vendor"
              />
              <p className="mt-1 text-xs text-slate-500">
                A unique identifier for this vendor's catalog. Used to namespace product IDs.
              </p>
            </div>

            <div>
              <label htmlFor="file" className="block text-sm font-medium text-slate-700">
                CSV File
              </label>
              <input
                type="file"
                id="file"
                accept=".csv"
                onChange={handleFileChange}
                required
                className="mt-2 block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
              />
              {file && (
                <p className="mt-2 text-sm text-slate-600">
                  Selected: <span className="font-medium">{file.name}</span> (
                  {(file.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isUploading || !file}
                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploading ? 'Uploading & Analyzing...' : 'Upload & Analyze'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Results Summary */}
      {summary && (
        <div className="mt-6 space-y-6">
          {/* Summary Metrics */}
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <h3 className="mb-4 text-lg font-medium text-slate-900">Upload Summary</h3>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <p className="text-sm text-slate-600">Total Rows</p>
                <p className="text-2xl font-semibold text-slate-900">{summary.totalRows}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Inserted</p>
                <p className="text-2xl font-semibold text-green-600">{summary.inserted}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Updated</p>
                <p className="text-2xl font-semibold text-blue-600">{summary.updated}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Invalid</p>
                <p className="text-2xl font-semibold text-red-600">{summary.invalidRows}</p>
              </div>
            </div>

            {/* Core Stats */}
            <div className="mt-6 border-t border-slate-200 pt-6">
              <h4 className="mb-3 text-sm font-medium text-slate-700">Data Coverage</h4>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-600">With Price</p>
                  <p className="text-lg font-medium text-slate-900">
                    {summary.coreStats.rowsWithPrice} / {summary.coreStats.totalRows}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">With Images</p>
                  <p className="text-lg font-medium text-slate-900">
                    {summary.coreStats.rowsWithImage} / {summary.coreStats.totalRows}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">With Description</p>
                  <p className="text-lg font-medium text-slate-900">
                    {summary.coreStats.rowsWithDescription} / {summary.coreStats.totalRows}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">With Category</p>
                  <p className="text-lg font-medium text-slate-900">
                    {summary.coreStats.rowsWithCategory} / {summary.coreStats.totalRows}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">With Brand</p>
                  <p className="text-lg font-medium text-slate-900">
                    {summary.coreStats.rowsWithBrand} / {summary.coreStats.totalRows}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Core Identity</p>
                  <p className="text-lg font-medium text-slate-900">
                    {summary.coreStats.rowsWithCoreIdentity} / {summary.coreStats.totalRows}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Dataset Context */}
          {summary.datasetContext && (
            <div className="rounded-lg border border-slate-200 bg-white p-6">
              <div className="mb-4 flex items-start justify-between">
                <h3 className="text-lg font-medium text-slate-900">Dataset Profile</h3>
                <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                  Active
                </span>
              </div>
              <p className="mb-4 text-sm text-slate-600">
                This metadata is automatically used to adapt LLM prompts and search behavior to your catalog's vertical and available facets, making the assistant industry-agnostic and schema-driven.
              </p>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {summary.datasetContext.vertical && (
                    <div>
                      <p className="text-xs text-slate-600">Vertical</p>
                      <p className="text-sm font-medium text-slate-900 capitalize">
                        {summary.datasetContext.vertical}
                      </p>
                    </div>
                  )}
                  {summary.datasetContext.dominantPriceCurrency && (
                    <div>
                      <p className="text-xs text-slate-600">Currency</p>
                      <p className="text-sm font-medium text-slate-900">
                        {summary.datasetContext.dominantPriceCurrency}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-slate-600">Price Data</p>
                    <p className="text-sm font-medium text-slate-900">
                      {summary.datasetContext.hasPriceData ? '✓ Yes' : '✗ No'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600">Images</p>
                    <p className="text-sm font-medium text-slate-900">
                      {summary.datasetContext.hasImages ? '✓ Yes' : '✗ No'}
                    </p>
                  </div>
                </div>

                {summary.datasetContext.primaryFacets.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-slate-600">Primary Facets</p>
                    <div className="flex flex-wrap gap-2">
                      {summary.datasetContext.primaryFacets.map((facet) => (
                        <span
                          key={facet}
                          className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
                        >
                          {facet}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {summary.datasetContext.recommendedSearchExamples.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-slate-600">Recommended Search Examples</p>
                    <div className="space-y-1">
                      {summary.datasetContext.recommendedSearchExamples.map((example, idx) => (
                        <p
                          key={idx}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                        >
                          "{example}"
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {summary.datasetContext.qualityNotes.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-slate-600">Quality Notes</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                      {summary.datasetContext.qualityNotes.map((note, idx) => (
                        <li key={idx}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Validation Issues */}
          {summary.issues.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-6">
              <h3 className="mb-4 text-lg font-medium text-slate-900">
                Validation Issues ({summary.issues.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-600">Row</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-600">Level</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-600">Field</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-600">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {summary.issues.slice(0, 100).map((issue, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2 text-sm text-slate-600">
                          {issue.rowIndex ?? '—'}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                              issue.level === 'error'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {issue.level}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-slate-600">{issue.field ?? '—'}</td>
                        <td className="px-4 py-2 text-sm text-slate-700">{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {summary.issues.length > 100 && (
                <p className="mt-4 text-sm text-slate-600">
                  Showing first 100 issues. Total: {summary.issues.length}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setSummary(null);
                setFile(null);
                setError(null);
              }}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Upload Another Catalog
            </button>
            <button
              className="rounded-lg border border-slate-300 bg-white px-6 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              This looks good
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

