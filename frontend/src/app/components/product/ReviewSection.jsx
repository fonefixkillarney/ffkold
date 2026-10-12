'use client';

import StarRating from '@/app/components/ui/StarRating';

function RatingBar({ label, count, total }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-gray-400 dark:text-gray-500 text-right">{pct}%</span>
    </div>
  );
}

export default function ReviewSection({ product }) {
  const breakdown = [5, 4, 3, 2, 1].map((star) => ({ star, count: 0 }));
  const rating = typeof product.rating === 'number' ? product.rating : 4.0;
  const reviewCount = product.reviewCount || 0;

  return (
    <section id="reviews" className="mt-8">
      <h2 className="section-heading">Customer Reviews</h2>

      <div className="flex flex-col sm:flex-row gap-6 mb-6 p-4 bg-surface rounded-lg border border-gray-200">
        <div className="flex flex-col items-center justify-center shrink-0">
          <span className="text-5xl font-black text-gray-800">{rating.toFixed(1)}</span>
          <StarRating rating={rating} size={18} showCount={false} />
          <span className="text-xs text-gray-500 mt-1">{reviewCount} reviews</span>
        </div>
        <div className="flex-1 flex flex-col justify-center gap-1.5">
          {breakdown.map(({ star, count }) => (
            <RatingBar key={star} label={`${star} ★`} count={count} total={reviewCount} />
          ))}
        </div>
      </div>

      <div className="text-center py-8 text-gray-400">
        <p className="text-2xl mb-2">💬</p>
        <p className="text-sm">No written reviews yet. Be the first!</p>
      </div>
    </section>
  );
}
