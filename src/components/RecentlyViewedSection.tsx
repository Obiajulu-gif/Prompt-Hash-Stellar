import { Link } from "react-router-dom";
import { Clock, X, Trash2 } from "lucide-react";
import {
  type RecentlyViewedPrompt,
} from "@/hooks/useRecentlyViewed";

const FALLBACK_IMAGE = "/images/codeguru.png";

interface RecentlyViewedSectionProps {
  items: RecentlyViewedPrompt[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function RecentlyViewedSection({
  items,
  onRemove,
  onClear,
}: RecentlyViewedSectionProps) {
  if (items.length === 0) return null;

  return (
    <section className="mb-16">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-400" />
          <h2 className="text-lg font-semibold text-white">Recently viewed</h2>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear history
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="group relative rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden hover:border-white/15 transition-colors"
          >
            <Link
              to={`/prompts/${item.id}`}
              className="block"
            >
              <div className="aspect-[16/9] w-full overflow-hidden bg-slate-900">
                <img
                  src={item.imageUrl || FALLBACK_IMAGE}
                  alt={item.title}
                  className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                  onError={(e) => {
                    e.currentTarget.src = FALLBACK_IMAGE;
                  }}
                />
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-white truncate">
                  {item.title}
                </p>
                <p className="text-xs text-slate-400 mt-1">{item.category}</p>
                <p className="text-[10px] text-slate-500 mt-1">
                  Viewed {formatRelativeTime(item.viewedAt)}
                </p>
              </div>
            </Link>

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onRemove(item.id);
              }}
              className="absolute top-2 right-2 p-1 rounded-full bg-slate-950/80 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Remove ${item.title} from history`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
