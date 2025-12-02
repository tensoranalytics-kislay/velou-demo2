import ChatWidget from '@/components/Chat/ChatWidget';
import HeroSection from '@/components/Site/HeroSection';
import ProductGrid from '@/components/Site/ProductGrid';
import SiteHeader from '@/components/Site/SiteHeader';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <HeroSection />
      <ProductGrid />
      <ChatWidget />
    </main>
  );
}
