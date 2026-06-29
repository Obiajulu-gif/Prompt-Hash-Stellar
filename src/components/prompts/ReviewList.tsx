import { StarRating } from "./StarRating";
import { User } from "lucide-react";

// Simple date formatting utility (replaces date-fns)
const formatDistanceToNow = (date: Date, options?: { addSuffix?: boolean }) => {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  const suffix = options?.addSuffix ? " ago" : "";

  if (years > 0) return `${years} year${years > 1 ? "s" : ""}${suffix}`;
  if (months > 0) return `${months} month${months > 1 ? "s" : ""}${suffix}`;
  if (days > 0) return `${days} day${days > 1 ? "s" : ""}${suffix}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""}${suffix}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""}${suffix}`;
  return `${seconds} second${seconds !== 1 ? "s" : ""}${suffix}`;
};

export interface Review {
  id: string;
  promptId: string;
  userAddress: string;
  rating: number;
  text: string;
  createdAt: number;
  verified: boolean;
}

interface ReviewListProps {
  reviews: Review[];
  isLoading?: boolean;
}

const formatAddress = (address: string) => {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const formatDate = (timestamp: number) => {
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return "Recently";
  }
};

export const ReviewList = ({ reviews, isLoading }: ReviewListProps) => {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="p-4 rounded-2xl bg-white/5 border border-white/5 animate-pulse"
          >
            <div className="h-4 w-32 bg-white/10 rounded mb-3" />
            <div className="h-3 w-full bg-white/10 rounded mb-2" />
            <div className="h-3 w-2/3 bg-white/10 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 mb-4">
          <User className="h-8 w-8 text-slate-600" />
        </div>
        <p className="text-slate-400 text-sm">No reviews yet</p>
        <p className="text-slate-500 text-xs mt-1">
          Be the first to share your experience
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reviews.map((review) => (
        <div
          key={review.id}
          className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center">
                <span className="text-white text-sm font-bold">
                  {review.userAddress.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    {formatAddress(review.userAddress)}
                  </span>
                  {review.verified && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                      Verified Buyer
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-500">
                  {formatDate(review.createdAt)}
                </span>
              </div>
            </div>
            <StarRating rating={review.rating} readonly size="sm" />
          </div>

          <p className="text-sm text-slate-300 leading-relaxed">
            {review.text}
          </p>
        </div>
      ))}
    </div>
  );
};
