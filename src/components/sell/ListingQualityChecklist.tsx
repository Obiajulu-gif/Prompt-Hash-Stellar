import { CheckCircle2, AlertCircle, XCircle, Info } from "lucide-react";
import {
  buildListingChecklistItems,
  type ListingChecklistItem,
  type ListingValidationOptions,
} from "@/lib/validation/listing";

export type ChecklistItem = ListingChecklistItem;

interface ListingQualityChecklistProps {
  items: ChecklistItem[];
}

const icons = {
  pass: <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />,
  fail: <XCircle className="h-4 w-4 text-red-400 shrink-0" />,
  warn: <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />,
  info: <Info className="h-4 w-4 text-slate-400 shrink-0" />,
};

const labelColors = {
  pass: "text-emerald-300",
  fail: "text-red-300",
  warn: "text-amber-300",
  info: "text-slate-400",
};

const hintColors = {
  pass: "text-emerald-400/70",
  fail: "text-red-400/70",
  warn: "text-amber-400/70",
  info: "text-slate-500",
};

export function ListingQualityChecklist({ items }: ListingQualityChecklistProps) {
  const failCount = items.filter((i) => i.status === "fail").length;
  const warnCount = items.filter((i) => i.status === "warn").length;
  const passCount = items.filter((i) => i.status === "pass").length;

  const borderColor =
    failCount > 0
      ? "border-red-400/20"
      : warnCount > 0
        ? "border-amber-400/20"
        : "border-emerald-400/20";

  const bgColor =
    failCount > 0
      ? "bg-red-500/5"
      : warnCount > 0
        ? "bg-amber-500/5"
        : "bg-emerald-500/5";

  const headingText =
    failCount > 0
      ? `${failCount} required ${failCount === 1 ? "issue" : "issues"} must be fixed before publishing`
      : warnCount > 0
        ? `${warnCount} optional ${warnCount === 1 ? "improvement" : "improvements"} — listing can still be published`
        : `Listing looks good — ${passCount} checks passed`;

  const headingColor =
    failCount > 0 ? "text-red-300" : warnCount > 0 ? "text-amber-300" : "text-emerald-300";

  return (
    <div
      className={`rounded-2xl border ${borderColor} ${bgColor} px-4 py-4 space-y-3`}
      role="region"
      aria-label="Listing quality checklist"
    >
      <p className={`text-sm font-semibold ${headingColor}`}>{headingText}</p>
      <ul className="space-y-2" role="list">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            {icons[item.status]}
            <span className="text-sm">
              <span className={labelColors[item.status]}>{item.label}</span>
              {item.hint ? (
                <span className={`ml-1 ${hintColors[item.status]}`}>— {item.hint}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function buildChecklistItems(
  formData: {
    imageUrl: string;
    title: string;
    category: string;
    previewText: string;
    fullPrompt: string;
    priceXlm: string;
  },
  options?: ListingValidationOptions,
): ChecklistItem[] {
  return buildListingChecklistItems(formData, options);
}
