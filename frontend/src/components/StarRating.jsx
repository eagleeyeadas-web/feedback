import { Star } from 'lucide-react';

const LABELS = ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

export default function StarRating({ value = 0, onChange, label, error, id }) {
  const handleKeyDown = (e, starValue) => {
    if (e.key === 'ArrowRight' && starValue < 5) {
      onChange(starValue + 1);
    } else if (e.key === 'ArrowLeft' && starValue > 1) {
      onChange(starValue - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onChange(starValue);
    }
  };

  return (
    <div id={id} className="flex flex-col sm:flex-row sm:items-center gap-2 py-2">
      <span className="text-sm font-medium text-gray-700 sm:w-52 shrink-0">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <div className="star-rating" role="radiogroup" aria-label={label}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              className="star-btn"
              role="radio"
              aria-checked={value === star}
              aria-label={`${star} star - ${LABELS[star - 1]}`}
              tabIndex={value === star || (value === 0 && star === 1) ? 0 : -1}
              onClick={() => onChange(star)}
              onKeyDown={(e) => handleKeyDown(e, star)}
            >
              <Star
                size={28}
                className={
                  star <= value
                    ? 'text-gold fill-gold'
                    : 'text-gray-300'
                }
                strokeWidth={1.5}
              />
            </button>
          ))}
        </div>
        {value > 0 && (
          <span className="ml-2 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {LABELS[value - 1]}
          </span>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
