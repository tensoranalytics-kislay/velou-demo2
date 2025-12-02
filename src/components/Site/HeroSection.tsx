'use client';

import { useState, useEffect } from 'react';

export default function HeroSection() {
  const [brandName, setBrandName] = useState('our store');
  const [vertical, setVertical] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/brand-info')
      .then((res) => res.json())
      .then((data) => {
        if (data.brandName) setBrandName(data.brandName);
        if (data.vertical) setVertical(data.vertical);
      })
      .catch(() => {
        // Keep defaults on error
      });
  }, []);

  const assistantTitle = vertical === 'skincare' || vertical === 'beauty'
    ? `${brandName} beauty assistant`
    : vertical === 'home' || vertical === 'home decor'
    ? `${brandName} home assistant`
    : `${brandName} stylist`;

  const description = vertical === 'skincare' || vertical === 'beauty'
    ? `Browse our skincare and beauty products, then chat with the ${brandName} beauty assistant to find products for your skin type, concerns, and routine.`
    : vertical === 'home' || vertical === 'home decor'
    ? `Browse our home decor and furnishings, then chat with the ${brandName} home assistant to find items for your space, style, and budget.`
    : `Browse the latest products pulled directly from our catalog, then chat with the ${brandName} stylist to fine-tune your search.`;

  return (
    <section className="mx-auto max-w-6xl rounded-3xl border border-rose-100 bg-rose-50/60 px-6 py-16 text-center md:px-12 md:py-20">
      <p className="text-xs uppercase tracking-[0.4em] text-rose-400">{brandName} concierge</p>
      <h2 className="mt-4 text-4xl font-semibold text-slate-900 md:text-5xl">
        Your {assistantTitle} is online
        </h2>
      <p className="mx-auto mt-4 max-w-3xl text-base text-slate-600 md:text-lg">
        {description}
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <button
          type="button"
          className="rounded-full bg-rose-500 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-200 transition hover:bg-rose-600"
        >
          Explore fresh arrivals
        </button>
        <button
          type="button"
          className="rounded-full border border-rose-200 bg-white px-8 py-3 text-sm font-semibold text-rose-500 transition hover:border-rose-300"
        >
          Ask the stylist
        </button>
      </div>
    </section>
  );
}

