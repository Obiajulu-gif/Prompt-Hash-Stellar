import { useState, useEffect } from "react";
import {
  ChevronDown,
  BookOpen,
  Lock,
  Wallet,
  Tag,
  Eye,
  CheckCircle2,
  Circle,
  X,
  ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  details: string[];
  icon: React.ReactNode;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "wallet",
    title: "Connect your wallet",
    description: "Link a Stellar wallet to receive payments and sign transactions.",
    details: [
      "Use a Stellar-compatible wallet (Albedo, Freighter, xBull, etc.).",
      "Your wallet address becomes your unique creator identifier.",
      "All transactions are signed locally — your keys never leave your device.",
      "Keep your wallet backed up with its recovery phrase.",
    ],
    icon: <Wallet className="h-4 w-4" />,
  },
  {
    id: "title",
    title: "Add a title & category",
    description: "A clear, descriptive title and the right category drive discovery.",
    details: [
      "Keep titles concise: 3–100 characters works best.",
      "Titles should immediately convey the prompt's purpose.",
      "Pick the category that most accurately matches your content.",
      "Good titles improve marketplace search ranking.",
    ],
    icon: <Tag className="h-4 w-4" />,
  },
  {
    id: "preview",
    title: "Write a preview & add an image",
    description: "The public-facing teaser buyers see before purchasing.",
    details: [
      "Preview text describes what the prompt does (max 200 chars).",
      "Image URL must be publicly accessible (https://).",
      "A compelling image increases click-through on browse cards.",
      "Don't reveal your full prompt — keep it as a teaser.",
    ],
    icon: <Eye className="h-4 w-4" />,
  },
  {
    id: "prompt",
    title: "Enter your prompt content",
    description: "Your premium content — encrypted in-browser before hitting the chain.",
    details: [
      "This is what buyers unlock after purchase.",
      "Content is AES-encrypted in your browser before being stored on-chain.",
      "Only paying buyers can decrypt and read it.",
      "Do not include personally identifiable information.",
    ],
    icon: <Lock className="h-4 w-4" />,
  },
  {
    id: "price",
    title: "Set a price in XLM",
    description: "Specify how much buyers pay in Stellar Lumens.",
    details: [
      "Minimum price is 0.1 XLM.",
      "Buyers pay exactly what you set — no hidden platform fees deducted here.",
      "Payments arrive directly to your connected wallet.",
      "You can update pricing at any time from the My Prompts tab.",
    ],
    icon: <Tag className="h-4 w-4" />,
  },
];

const LISTING_PROCESS_STEPS = [
  { step: "1", label: "Fill in the form fields below." },
  { step: "2", label: "The quality checklist validates your listing." },
  { step: "3", label: "Your prompt is encrypted locally." },
  { step: "4", label: "The encrypted listing is published on-chain." },
  { step: "5", label: "Buyers discover and unlock it from the marketplace." },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DISMISS_KEY_PREFIX = "prompt-hash:onboarding-dismissed:";

function getDismissKey(walletAddress?: string): string {
  return walletAddress
    ? `${DISMISS_KEY_PREFIX}${walletAddress}`
    : `${DISMISS_KEY_PREFIX}anonymous`;
}

function wasDismissed(walletAddress?: string): boolean {
  try {
    return window.localStorage.getItem(getDismissKey(walletAddress)) === "1";
  } catch {
    return false;
  }
}

function persistDismiss(walletAddress?: string): void {
  try {
    window.localStorage.setItem(getDismissKey(walletAddress), "1");
  } catch {
    // ignore
  }
}

function clearDismiss(walletAddress?: string): void {
  try {
    window.localStorage.removeItem(getDismissKey(walletAddress));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CreatorOnboardingProps {
  /** IDs of steps the creator has already completed (drives checkmarks). */
  completedStepIds?: string[];
  /** Whether this is the creator's first listing (affects heading copy). */
  isFirstListing?: boolean;
  /** Wallet address — used to persist dismiss state per user. */
  walletAddress?: string;
}

export function CreatorOnboarding({
  completedStepIds = [],
  isFirstListing = true,
  walletAddress,
}: CreatorOnboardingProps) {
  const [visible, setVisible] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [showProcess, setShowProcess] = useState(false);

  // Decide initial visibility
  useEffect(() => {
    if (!wasDismissed(walletAddress)) {
      setVisible(true);
      // Auto-expand the first incomplete step
      const firstIncomplete = ONBOARDING_STEPS.find(
        (s) => !completedStepIds.includes(s.id),
      );
      if (firstIncomplete) {
        setExpandedSteps(new Set([firstIncomplete.id]));
      }
    }
  }, [walletAddress]);

  const handleDismiss = () => {
    persistDismiss(walletAddress);
    setVisible(false);
  };

  const handleShowAgain = () => {
    clearDismiss(walletAddress);
    setVisible(true);
  };

  const toggleStep = (id: string) => {
  setExpandedSteps((prev) => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  });
};

  const completedCount = ONBOARDING_STEPS.filter((s) =>
    completedStepIds.includes(s.id),
  ).length;
  const totalCount = ONBOARDING_STEPS.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);
  const allDone = completedCount === totalCount;

  // Not visible — render a subtle "show guide" link
  if (!visible) {
    return (
      <div className="flex justify-end mb-2">
        <button
          onClick={handleShowAgain}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Show listing guide
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-blue-400/20 bg-blue-500/5 overflow-hidden mb-8">
      {/* Header */}
      <div className="flex items-start gap-4 px-6 pt-6 pb-4">
        <BookOpen className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-white text-sm">
            {isFirstListing ? "Welcome — let's get your first listing live 🚀" : "Creator Listing Guide"}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {isFirstListing
              ? "Complete the steps below to publish your first encrypted prompt."
              : "Review the listing requirements to ensure your prompt is ready."}
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 text-slate-500 hover:text-slate-300 transition rounded p-1 hover:bg-white/5"
          aria-label="Dismiss onboarding guide"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="px-6 pb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-400">
            {allDone ? "All steps complete!" : `${completedCount} of ${totalCount} steps completed`}
          </span>
          <span className={`text-xs font-semibold ${allDone ? "text-emerald-400" : "text-blue-400"}`}>
            {progressPct}%
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              allDone ? "bg-emerald-400" : "bg-blue-400"
            }`}
            style={{ width: `${progressPct}%` }}
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Onboarding progress"
          />
        </div>
      </div>

      {/* Steps */}
      <div className="px-6 space-y-2 pb-4">
        {ONBOARDING_STEPS.map((step) => {
          const isComplete = completedStepIds.includes(step.id);
          const isExpanded = expandedSteps.has(step.id);

          return (
            <div
              key={step.id}
              className={`rounded-xl border overflow-hidden transition-colors ${
                isComplete
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-blue-400/10 bg-slate-900/50"
              }`}
            >
              <button
                onClick={() => toggleStep(step.id)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition text-left"
                aria-expanded={isExpanded}
              >
                {/* Status icon */}
                <span className={isComplete ? "text-emerald-400" : "text-slate-500"}>
                  {isComplete ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Circle className="h-4 w-4" />
                  )}
                </span>

                {/* Step icon */}
                <span className={isComplete ? "text-emerald-400/70" : "text-blue-400"}>
                  {step.icon}
                </span>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${isComplete ? "text-emerald-200" : "text-white"}`}>
                    {step.title}
                    {isComplete && (
                      <span className="ml-2 text-xs font-normal text-emerald-400/70">✓ done</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{step.description}</p>
                </div>

                <ChevronDown
                  className={`h-4 w-4 text-slate-500 shrink-0 transition-transform ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isExpanded && (
                <div className="border-t border-white/5 px-4 py-3 bg-slate-900/30">
                  <ul className="space-y-2">
                    {step.details.map((detail, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-400 leading-relaxed">
                        <span className="text-blue-400 font-bold mt-0.5">•</span>
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* How listing works — collapsible */}
      <div className="border-t border-white/5 mx-6 mb-4">
        <button
          onClick={() => setShowProcess((v) => !v)}
          className="w-full flex items-center gap-2 py-3 text-xs text-slate-500 hover:text-slate-300 transition text-left"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${showProcess ? "rotate-90" : ""}`}
          />
          How the listing process works
        </button>
        {showProcess && (
          <div className="pb-3 flex flex-wrap gap-2">
            {LISTING_PROCESS_STEPS.map(({ step, label }) => (
              <div
                key={step}
                className="flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-500/8 px-3 py-1 text-xs text-emerald-200"
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400/20 text-[10px] font-bold text-emerald-300 shrink-0">
                  {step}
                </span>
                {label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* All done call-out */}
      {allDone && (
        <div className="mx-6 mb-5 p-3 bg-emerald-500/10 border border-emerald-400/20 rounded-xl">
          <p className="text-xs text-emerald-300 leading-relaxed">
            🎉 All steps complete! Your listing is ready to publish. Click{" "}
            <strong>Create prompt listing</strong> below when you're happy.
          </p>
        </div>
      )}
    </div>
  );
}
