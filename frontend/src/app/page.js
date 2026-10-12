import { Suspense } from 'react';
import HeroSlider from '@/app/components/home/HeroSlider';
import Sidebar from '@/app/components/layout/Sidebar';
import FeaturedProducts from '@/app/components/home/FeaturedProducts';

export default function HomePage() {
  return (
    <>
      <HeroSlider />
      <div className="container-main">
        <div className="flex min-h-[60vh] py-6 lg:py-10">
          <Suspense fallback={null}>
            <Sidebar />
          </Suspense>
          <Suspense fallback={null}>
            <FeaturedProducts />
          </Suspense>
        </div>
      </div>
    </>
  );
}
