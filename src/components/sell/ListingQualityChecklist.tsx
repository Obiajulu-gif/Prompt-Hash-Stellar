import { CheckCircle2, AlertCircle, XCircle, Info } from "lucide-react";

export interface ChecklistItem {
  id: string;
  label: string;
  /** true = passes, false = fails, null = warning (non-blocking) */
  status: "pass" | "fail" | "warn" | "info";
  hint?: string;
}

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

/**
 * Derive checklist items from the current form state.
 * Returns required (fail) and recommended (warn) checks.
 */
export function buildChecklistItems(formData: {
  imageUrl: string;
  title: string;
  category: string;
  previewText: string;
  fullPrompt: string;
  priceXlm: string;
}): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  // ── Required checks (block submission) ──────────────────────────────────

  items.push({
    id: "title",
    label: "Title",
    status: formData.title.trim().length > 0 ? "pass" : "fail",
    hint: formData.title.trim().length === 0 ? "A title is required" : undefined,
  });

  items.push({
    id: "category",
    label: "Category",
    status: formData.category ? "pass" : "fail",
    hint: !formData.category ? "Select a category" : undefined,
  });

  items.push({
    id: "previewText",
    label: "Preview text",
    status: formData.previewText.trim().length > 0 ? "pass" : "fail",
    hint: formData.previewText.trim().length === 0 ? "Preview text is required" : undefined,
  });

  items.push({
    id: "fullPrompt",
    label: "Full prompt content",
    status: formData.fullPrompt.trim().length > 0 ? "pass" : "fail",
    hint: formData.fullPrompt.trim().length === 0 ? "Full prompt is required" : undefined,
  });

  const price = parseFloat(formData.priceXlm);
  items.push({
    id: "price",
    label: "Price",
    status: !isNaN(price) && price > 0 ? "pass" : "fail",
    hint: isNaN(price) || price <= 0 ? "Enter a valid XLM price greater than zero" : undefined,
  });

  items.push({
    id: "imageUrl",
    label: "Image URL",
    status: formData.imageUrl.trim().length > 0 ? "pass" : "fail",
    hint: formData.imageUrl.trim().length === 0 ? "An image URL is required" : undefined,
  });

  // ── Recommended checks (warn, non-blocking) ──────────────────────────────

  const titleWords = formData.title.trim().split(/\s+/).filter(Boolean).length;
  if (formData.title.trim().length > 0 && titleWords < 3) {
    items.push({
      id: "title-length",
      label: "Title could be more descriptive",
      status: "warn",
      hint: "Aim for at least 3 words to help buyers find your listing",
    });
  }

  const previewLen = formData.previewText.trim().length;
  if (previewLen > 0 && previewLen < 60) {
    items.push({
      id: "preview-length",
      label: "Preview text is short",
      status: "warn",
      hint: "A longer preview (60+ characters) improves buyer confidence",
    });
  }

  const promptLen = formData.fullPrompt.trim().length;
  if (promptLen > 0 && promptLen < 100) {
    items.push({
      id: "prompt-length",
      label: "Full prompt seems short",
      status: "warn",
      hint: "Buyers expect substantial prompt content — consider expanding it",
    });
  }

  if (!isNaN(price) && price > 0 && price < 0.5) {
    items.push({
      id: "price-low",
      label: "Price is very low",
      status: "warn",
      hint: "Listings under 0.5 XLM may signal low quality to buyers",
    });
  }

  const imageUrl = formData.imageUrl.trim();
  if (imageUrl.length > 0 && !/^https?:\/\//i.test(imageUrl)) {
    items.push({
      id: "image-url-format",
      label: "Image URL does not start with http:// or https://",
      status: "warn",
      hint: "Use a full URL so the image loads correctly on browse cards",
    });
  }

  return items;
}
