import { Star } from 'lucide-react';

export default function StarRating({ rating, count, size = 14, showCount = true }) {
  const stars = Array.from({ length: 5 }, (_, i) => {
    const filled = i < Math.floor(rating);
    const half = !filled && i < rating;
    return { filled, half };
  });

  return (
    <span className="inline-flex items-center gap-1">
      <span className="flex items-center">
        {stars.map((s, i) => (
          <Star
            key={i}
            size={size}
            className={s.filled || s.half ? 'star-filled' : 'star-empty'}
            fill={s.filled ? 'currentColor' : s.half ? 'url(#half)' : 'none'}
          />
        ))}
      </span>
      {showCount && count !== undefined && (
        <span className="text-xs text-gray-500 dark:text-gray-400">({count})</span>
      )}
    </span>
  );
}
