import { Star } from "lucide-react";
import { useState } from "react";

interface StarRatingProps {
  rating: number;
  onRatingChange?: (_rating: number) => void;
  readonly?: boolean;
  size?: "sm" | "md" | "lg";
  showCount?: boolean;
  reviewCount?: number;
}
 

const sizeClasses = {
  sm: "h-3 w-3",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

export const StarRating = ({
  rating,
  onRatingChange,
  readonly = false,
  size = "md",
  showCount = false,
  reviewCount = 0,
}: StarRatingProps) => {
  const [hoverRating, setHoverRating] = useState(0);
  const displayRating = readonly ? rating : hoverRating || rating;

  const handleClick = (value: number) => {
    if (!readonly && onRatingChange) {
      onRatingChange(value);
    }
  };

  return (
    <div
      className="flex items-center gap-2"
      role={readonly ? "img" : "radiogroup"}
      aria-label={
        readonly
          ? `Rating: ${rating.toFixed(1)} out of 5 stars`
          : "Rate this prompt"
      }
    >
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((value) => {
          const isFilled = value <= displayRating;
          const isPartial = !Number.isInteger(displayRating) && 
                           value === Math.ceil(displayRating);
          
          return (
            <button
              key={value}
              type="button"
              disabled={readonly}
              tabIndex={readonly ? -1 : 0}
              aria-hidden={readonly ? "true" : undefined}
              role={readonly ? undefined : "radio"}
              aria-checked={readonly ? undefined : rating === value}
              aria-label={readonly ? undefined : `Rate ${value} star${value === 1 ? "" : "s"}`}
              onClick={() => handleClick(value)}
              onMouseEnter={() => !readonly && setHoverRating(value)}
              onMouseLeave={() => !readonly && setHoverRating(0)}
              className={`
                ${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"}
                transition-transform
              `}
            >
              <Star
                className={`
                  ${sizeClasses[size]}
                  ${isFilled ? "fill-yellow-400 text-yellow-400" : "text-slate-600"}
                  ${isPartial ? "fill-yellow-400/50" : ""}
                  transition-colors
                `}
              />
            </button>
          );
        })}
      </div>
      
      {showCount && reviewCount > 0 && (
        <span className="text-xs text-slate-400" aria-hidden="true">
          ({reviewCount} {reviewCount === 1 ? "review" : "reviews"})
        </span>
      )}
      
      {!showCount && rating > 0 && (
        <span className="text-xs text-slate-400 font-medium" aria-hidden="true">
          {rating.toFixed(1)}
        </span>
      )}
    </div>
  );
};
