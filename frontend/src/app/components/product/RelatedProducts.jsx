'use client';

import { useData } from '@/context/DataContext';
import ProductCard from '@/app/components/category/ProductCard';
import Link from 'next/link';

export default function RelatedProducts({ product }) {
  const { products } = useData();
  const related = products
    .filter((p) => p.category === product.category && p.id !== product.id)
    .slice(0, 4);

  if (related.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-heading mb-0 border-0 pb-0">Related Products</h2>
        <Link
          href={`/category/${product.category}`}
          className="text-xs text-primary hover:underline"
        >
          View all →
        </Link>
      </div>
      {/* <div className="border-b-2 border-primary mb-4" /> */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {related.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
