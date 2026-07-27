import { useState, useEffect, useCallback } from "react";
import { X, ChevronRight } from "lucide-react";

const STORAGE_KEY = "prompthash_onboarding_done";

interface TourStep {
  selector: string;
  title: string;
  description: string;
}

const STEPS: TourStep[] = [
  {
    selector: '[data-tour="connect-wallet"]',
    title: "Connect your Wallet",
    description:
      "Click here to connect your Stellar wallet. You need a wallet to buy or sell prompts on PromptHash.",
  },
  {
    selector: '[data-tour="marketplace-search"]',
    title: "Search the Marketplace",
    description:
      "Use the search bar to find prompts by keyword, category, or AI model. Filter by price and popularity.",
  },
  {
    selector: '[data-tour="purchase-btn"]',
    title: "Purchase a Prompt",
    description:
      'Click "Buy Access" on any prompt listing to purchase a license in XLM. Your wallet will confirm the transaction.',
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getRect(selector: string): Rect | null {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top + window.scrollY,
    left: r.left + window.scrollX,
    width: r.width,
    height: r.height,
  };
}

export function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [active, setActive] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    // Small delay so the page is fully rendered
    const t = setTimeout(() => setActive(true), 800);
    return () => clearTimeout(t);
  }, []);

  const updateRect = useCallback(() => {
    if (!active) return;
    setRect(getRect(STEPS[step].selector));
  }, [active, step]);

  useEffect(() => {
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect);
    };
  }, [updateRect]);

  function finish() {
    localStorage.setItem(STORAGE_KEY, "1");
    setActive(false);
  }

  function next() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      finish();
    }
  }

  if (!active) return null;

  const currentStep = STEPS[step];
  const PAD = 8;

  // Card positioning: below the highlighted element if possible
  const cardTop = rect ? rect.top + rect.height + PAD + 16 : "50%";
  const cardLeft = rect ? Math.max(16, rect.left) : "50%";

  return (
    <>
      {/* Dark overlay with a "hole" cut out around the target */}
      <div className="fixed inset-0 z-[90] pointer-events-none">
        {rect ? (
          <svg
            className="absolute inset-0 w-full h-full"
            style={{ width: "100vw", height: "100vh" }}
          >
            <defs>
              <mask id="tour-mask">
                <rect width="100%" height="100%" fill="white" />
                <rect
                  x={rect.left - PAD}
                  y={rect.top - PAD}
                  width={rect.width + PAD * 2}
                  height={rect.height + PAD * 2}
                  rx={8}
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.65)"
              mask="url(#tour-mask)"
            />
            {/* Highlight ring */}
            <rect
              x={rect.left - PAD}
              y={rect.top - PAD}
              width={rect.width + PAD * 2}
              height={rect.height + PAD * 2}
              rx={8}
              fill="none"
              stroke="rgb(251 191 36)"
              strokeWidth="2"
            />
          </svg>
        ) : (
          <div className="absolute inset-0 bg-black/65" />
        )}
      </div>

      {/* Tooltip card */}
      <div
        className="fixed z-[100] w-72 rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
        style={
          rect
            ? { top: cardTop, left: cardLeft }
            : { top: "50%", left: "50%", transform: "translate(-50%,-50%)" }
        }
      >
        {/* Step indicator + close */}
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-amber-400 font-medium">
            Step {step + 1} of {STEPS.length}
          </span>
          <button
            onClick={finish}
            className="rounded-full p-1 text-slate-500 hover:text-white"
            aria-label="Skip tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h3 className="text-base font-semibold text-white mb-1">
          {currentStep.title}
        </h3>
        <p className="text-sm text-slate-400 leading-relaxed">
          {currentStep.description}
        </p>

        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={finish}
            className="text-xs text-slate-500 hover:text-slate-300 underline"
          >
            Skip tour
          </button>
          <button
            onClick={next}
            className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-4 py-1.5 text-sm font-medium text-slate-950 hover:bg-amber-300"
          >
            {step < STEPS.length - 1 ? (
              <>
                Next <ChevronRight className="h-4 w-4" />
              </>
            ) : (
              "Done"
            )}
          </button>
        </div>
      </div>
    </>
  );
}
