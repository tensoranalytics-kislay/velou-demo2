'use client';

import { useState, useEffect } from 'react';

type PageTypeSimulatorProps = {
  pageType: 'HOME' | 'PLP' | 'PDP';
  productContextId?: string;
  onPageTypeChange: (type: 'HOME' | 'PLP' | 'PDP') => void;
  onProductContextChange: (id: string | undefined) => void;
};

export default function PageTypeSimulator({
  pageType,
  productContextId,
  onPageTypeChange,
  onProductContextChange,
}: PageTypeSimulatorProps) {
  const [productIds, setProductIds] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/admin/products?limit=10')
      .then((res) => res.json())
      .then((data: { products: Array<{ id: string }> }) => {
        setProductIds(data.products.map((p) => p.id));
      })
      .catch(() => {});
  }, []);

  const handlePageTypeChange = (type: 'HOME' | 'PLP' | 'PDP') => {
    onPageTypeChange(type);
    if (type !== 'PDP') {
      onProductContextChange(undefined);
    } else if (productIds.length > 0 && !productContextId) {
      onProductContextChange(productIds[0]);
    }
  };

  return (
    <div className="flex flex-col gap-2 text-right">
      <div className="flex gap-1">
        {(['HOME', 'PLP', 'PDP'] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => handlePageTypeChange(type)}
            className={`rounded px-2 py-1 text-xs font-medium transition ${
              pageType === type
                ? 'bg-[#D61F2B] text-[#FEEEED]'
                : 'bg-white/70 text-slate-600 hover:bg-white'
            }`}
          >
            {type}
          </button>
        ))}
      </div>
      {pageType === 'PDP' && productIds.length > 0 && (
        <select
          value={productContextId || ''}
          onChange={(e) => onProductContextChange(e.target.value || undefined)}
          className="rounded border border-[#D61F2B]/30 bg-[#FEEEED] px-2 py-1 text-xs text-slate-700"
        >
          <option value="">Select product...</option>
          {productIds.slice(0, 5).map((id) => (
            <option key={id} value={id}>
              {id.slice(0, 20)}...
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

