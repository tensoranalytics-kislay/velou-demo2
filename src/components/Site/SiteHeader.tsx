import Image from 'next/image';

const navLinks = [
  { label: 'Women', href: '#' },
  { label: 'Denim', href: '#' },
  { label: 'Shoes', href: '#' },
];

export default function SiteHeader() {
  return (
    <header className="mb-6 border-b border-rose-100 bg-white/90 pb-3 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-8">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Image
              src="/lucky-brand-logo.png"
              alt="Lucky Brand"
              width={240}
              height={45}
              className="h-7 w-auto object-contain md:h-8"
              priority
            />
            <span className="hidden text-xs uppercase tracking-[0.45em] text-rose-400 sm:inline">
              since 1990
            </span>
          </div>
          <nav className="hidden gap-6 md:flex">
            {navLinks.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="text-sm font-medium text-slate-500 transition hover:text-rose-500"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
        <button
          type="button"
          className="rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-500 shadow-sm transition hover:bg-rose-50"
        >
          New arrivals
        </button>
      </div>
    </header>
  );
}

