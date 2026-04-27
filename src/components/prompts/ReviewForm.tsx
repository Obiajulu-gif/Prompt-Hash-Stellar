import { useState } from "react";
import { StarRating } from "./StarRating";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Loader2, Send } from "lucide-react";

interface ReviewFormProps {
  promptId: string;
  onSubmit: (review: { rating: number; text: string }) => Promise<void>;
  onCancel?: () => void;
}

export const ReviewForm = ({ promptId, onSubmit, onCancel }: ReviewFormProps) => {
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (rating === 0) {
      setError("Please select a rating");
      return;
    }

    if (reviewText.trim().length < 10) {
      setError("Review must be at least 10 characters");
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({ rating, text: reviewText.trim() });
      setRating(0);
      setReviewText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-semibold text-white">Your Rating</label>
        <StarRating rating={rating} onRatingChange={setRating} size="lg" />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-white">Your Review</label>
        <Textarea
          value={reviewText}
          onChange={(e) => setReviewText(e.target.value)}
          placeholder="Share your experience with this prompt..."
          className="min-h-[120px] bg-white/5 border-white/10 text-white placeholder:text-slate-500 resize-none"
          maxLength={500}
        />
        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-500">
            {reviewText.length}/500 characters
          </span>
          {reviewText.length >= 10 && (
            <span className="text-xs text-emerald-400">✓ Minimum length met</span>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={isSubmitting || rating === 0 || reviewText.trim().length < 10}
          className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold h-11"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              Submit Review
            </>
          )}
        </Button>
        
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-white"
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
};
