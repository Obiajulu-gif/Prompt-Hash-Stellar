import { useState } from "react";
import { X, Plus, Star, Tag, Shield, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPriceLabel } from "@/lib/stellar/format";

export interface ComparisonPrompt {
  id: string;
  title: string;
  creator: string;
  price: bigint;
  category: string;
  tags?: string[];
  rating?: number;
  licenseType?: string;
  isOwned?: boolean;
  preview?: string;
}

const MAX_COMPARE = 3;

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-3.5 w-3.5 ${n <= Math.round(rating) ? "fill-yellow-400 text-yellow-400" : "text-white/20"}`}
        />
      ))}
      <span className="ml-1 text-xs text-slate-400">{rating.toFixed(1)}</span>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/10 py-3 px-4">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</div>
      <div className="text-sm text-white">{children}</div>
    </div>
  );
}

interface PromptComparisonViewProps {
  selected: ComparisonPrompt[];
  // eslint-disable-next-line no-unused-vars
  onRemove: (_id: string) => void;
  onClear: () => void;
}

export function PromptComparisonView({
  selected,
  onRemove,
  onClear,
}: PromptComparisonViewProps) {
  if (selected.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 p-10 text-center">
        <p className="text-slate-400 text-sm">
          Select up to {MAX_COMPARE} prompts to compare them side by side.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Compare Prompts{" "}
          <span className="text-sm font-normal text-slate-400">
            ({selected.length}/{MAX_COMPARE})
          </span>
        </h2>
        <Button size="sm" variant="ghost" onClick={onClear} className="text-slate-400 hover:text-white">
          Clear all
        </Button>
      </div>

      {/* Side-by-side grid */}
      <div
        className="grid gap-4 overflow-x-auto"
        style={{ gridTemplateColumns: `repeat(${selected.length}, minmax(220px, 1fr))` }}
      >
        {selected.map((prompt) => (
          <div
            key={prompt.id}
            className="relative rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden"
          >
            {/* Remove button */}
            <button
              onClick={() => onRemove(prompt.id)}
              className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-slate-400 hover:text-white transition-colors"
              aria-label={`Remove ${prompt.title} from comparison`}
            >
              <X className="h-3 w-3" />
            </button>

            {/* Header */}
            <div className="p-4 pb-0">
              <h3 className="pr-6 font-semibold text-white leading-snug line-clamp-2">{prompt.title}</h3>
              <p className="mt-0.5 text-xs text-slate-400">by {prompt.creator}</p>
            </div>

            {/* Fields */}
            <div className="mt-3">
              <FieldRow label="Price">
                <span className="font-bold text-cyan-300">{formatPriceLabel(prompt.price)}</span>
              </FieldRow>

              <FieldRow label="Category">
                <Badge variant="secondary" className="text-xs">{prompt.category}</Badge>
              </FieldRow>

              <FieldRow label="Rating">
                {prompt.rating !== undefined ? (
                  <StarRating rating={prompt.rating} />
                ) : (
                  <span className="text-slate-500">No ratings</span>
                )}
              </FieldRow>

              <FieldRow label="Tags">
                {prompt.tags && prompt.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {prompt.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-0.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">
                        <Tag className="h-2.5 w-2.5" />
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-500">No tags</span>
                )}
              </FieldRow>

              <FieldRow label="License">
                <span className="inline-flex items-center gap-1">
                  <Shield className="h-3 w-3 text-slate-400" />
                  {prompt.licenseType ?? "Standard"}
                </span>
              </FieldRow>

              <FieldRow label="Preview">
                <p className="line-clamp-3 text-slate-300 text-xs leading-relaxed">
                  {prompt.preview ?? "No preview available."}
                </p>
              </FieldRow>

              <FieldRow label="Status">
                {prompt.isOwned ? (
                  <span className="inline-flex items-center gap-1 text-green-400 text-xs font-medium">
                    <Check className="h-3.5 w-3.5" />
                    Owned
                  </span>
                ) : (
                  <span className="text-slate-400 text-xs">Not purchased</span>
                )}
              </FieldRow>
            </div>
          </div>
        ))}

        {/* Placeholder slot when fewer than MAX_COMPARE selected */}
        {selected.length < MAX_COMPARE && (
          <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-white/15 text-slate-500">
            <div className="text-center">
              <Plus className="mx-auto mb-2 h-6 w-6" />
              <p className="text-xs">Add prompt to compare</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Hook to manage comparison state — max 3 prompts, no duplicates */
export function usePromptComparison() {
  const [selected, setSelected] = useState<ComparisonPrompt[]>([]);

  const addToComparison = (prompt: ComparisonPrompt) => {
    setSelected((prev) => {
      if (prev.length >= MAX_COMPARE) return prev;
      if (prev.some((p) => p.id === prompt.id)) return prev;
      return [...prev, prompt];
    });
  };

  const removeFromComparison = (id: string) => {
    setSelected((prev) => prev.filter((p) => p.id !== id));
  };

  const clearComparison = () => setSelected([]);

  const isSelected = (id: string) => selected.some((p) => p.id === id);
  const canAdd = selected.length < MAX_COMPARE;

  return { selected, addToComparison, removeFromComparison, clearComparison, isSelected, canAdd };
}
