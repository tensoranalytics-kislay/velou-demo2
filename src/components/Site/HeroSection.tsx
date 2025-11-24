export default function HeroSection() {
  return (
    <section className="mx-auto max-w-6xl rounded-3xl border border-rose-100 bg-rose-50/60 px-6 py-16 text-center md:px-12 md:py-20">
      <p className="text-xs uppercase tracking-[0.4em] text-rose-400">Lucky Brand concierge</p>
      <h2 className="mt-4 text-4xl font-semibold text-slate-900 md:text-5xl">
        Your Lucky Brand stylist is online
        </h2>
      <p className="mx-auto mt-4 max-w-3xl text-base text-slate-600 md:text-lg">
        Browse the latest denim, dresses, and everyday essentials pulled directly from our catalog,
        then chat with the Lucky Brand stylist to fine-tune fit, fabric, and budget.
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

