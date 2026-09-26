import { useState } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";

const PRICE_TIERS = [
  { label: "Starter", range: "1 – 5 XLM", description: "Short utility prompts, single-task instructions" },
  { label: "Standard", range: "5 – 20 XLM", description: "Multi-step workflows, domain-specific templates" },
  { label: "Premium", range: "20 – 100 XLM", description: "Expert-tuned, research-backed system prompts" },
  { label: "Professional", range: "100+ XLM", description: "Enterprise-grade, actively maintained prompt suites" },
];

const TIPS = [
  "Check what similar prompts in your category sell for before setting a price.",
  "Lower prices attract more buyers; higher prices signal exclusivity — choose based on your goal.",
  "You can update the price after listing without redeploying the contract.",
  "Prompts under 5 XLM typically see 3–5× more trial purchases.",
];

interface PricingGuidanceProps {
  currentPriceXlm: string;
}

function getPriceTierLabel(xlm: string): string | null {
  const value = parseFloat(xlm);
  if (!isFinite(value) || value <= 0) return null;
  if (value <= 5) return "Starter";
  if (value <= 20) return "Standard";
  if (value <= 100) return "Premium";
  return "Professional";
}

export function PricingGuidance({ currentPriceXlm }: PricingGuidanceProps) {
  const [open, setOpen] = useState(false);
  const activeTier = getPriceTierLabel(currentPriceXlm);

  return (
    <div className="rounded-xl border border-indigo-400/20 bg-indigo-500/5 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-indigo-200 hover:text-indigo-100"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0" />
          Pricing guidance
          {activeTier && (
            <span className="rounded-full bg-indigo-400/20 px-2 py-0.5 text-xs text-indigo-100">
              {activeTier}
            </span>
          )}
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="border-t border-indigo-400/10 px-4 pb-4 pt-3 space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PRICE_TIERS.map((tier) => (
              <div
                key={tier.label}
                className={`rounded-lg border p-3 transition-colors ${
                  activeTier === tier.label
                    ? "border-indigo-400/40 bg-indigo-400/10 text-indigo-100"
                    : "border-white/10 bg-white/[0.03] text-slate-400"
                }`}
              >
                <p className="font-semibold text-white text-xs">{tier.label}</p>
                <p className="mt-0.5 text-xs font-mono text-indigo-300">{tier.range}</p>
                <p className="mt-1.5 text-xs leading-5 text-slate-400">{tier.description}</p>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tips</p>
            <ul className="space-y-1">
              {TIPS.map((tip, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-400">
                  <span className="mt-0.5 shrink-0 text-indigo-400">•</span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
