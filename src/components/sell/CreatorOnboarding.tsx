import { useState } from "react";
import { ChevronDown, BookOpen, Lock, Wallet, Tag, Eye } from "lucide-react";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  details: string[];
  icon: React.ReactNode;
}

const onboardingSteps: OnboardingStep[] = [
  {
    id: "wallet",
    title: "Connect Wallet",
    description: "Connect your Stellar wallet to receive payments and manage listings",
    details: [
      "Use a Stellar-compatible wallet (Albedo, Freighter, etc.)",
      "Your wallet address becomes your creator identifier",
      "All transactions will be signed by this wallet",
      "Keep your wallet secure and backed up",
    ],
    icon: <Wallet className="h-5 w-5" />,
  },
  {
    id: "title",
    title: "Add Title & Category",
    description: "Create a clear, descriptive title and select the appropriate category",
    details: [
      "Keep titles concise (3-100 characters)",
      "Titles should clearly describe the prompt's purpose",
      "Select a category that matches your prompt's function",
      "Good titles help buyers find your prompts",
    ],
    icon: <Tag className="h-5 w-5" />,
  },
  {
    id: "preview",
    title: "Add Preview Metadata",
    description: "Provide a brief preview and add an image to attract potential buyers",
    details: [
      "Preview text describes what the prompt does (max 200 chars)",
      "Image URL should be a valid, publicly accessible link",
      "Image helps create visual interest on the marketplace",
      "Clear preview increases conversion rates",
    ],
    icon: <Eye className="h-5 w-5" />,
  },
  {
    id: "prompt",
    title: "Enter Prompt Content",
    description: "Paste your actual prompt content — this will be encrypted on-chain",
    details: [
      "This is the premium content buyers will unlock",
      "Content is encrypted before being stored on-chain",
      "Only buyers who pay can decrypt and access it",
      "Do not include sensitive personal information",
    ],
    icon: <Lock className="h-5 w-5" />,
  },
  {
    id: "price",
    title: "Set Price in XLM",
    description: "Specify the price in Stellar Lumens (XLM) for your prompt",
    details: [
      "Price must be greater than 0.1 XLM",
      "Price is used as-is; any fees are included in it",
      "Buyers pay exactly what you set",
      "You receive payments directly to your wallet",
    ],
    icon: <Tag className="h-5 w-5" />,
  },
];

interface CreatorOnboardingProps {
  isFirstListing?: boolean;
  onDismiss?: () => void;
}

export function CreatorOnboarding({ isFirstListing = true, onDismiss }: CreatorOnboardingProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(
    isFirstListing ? new Set(["wallet", "title"]) : new Set()
  );

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  return (
    <div className="rounded-2xl border border-blue-400/20 bg-blue-500/5 p-6 mb-8">
      <div className="flex items-start gap-4 mb-6">
        <BookOpen className="h-6 w-6 text-blue-400 shrink-0 mt-1" />
        <div className="flex-1">
          <h3 className="font-bold text-white mb-1">Creator Onboarding</h3>
          <p className="text-sm text-slate-400">
            {isFirstListing
              ? "Your first listing! Here's what you need to know before publishing."
              : "Review the listing requirements to ensure your prompt is ready for the marketplace."}
          </p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-slate-500 hover:text-slate-300 transition"
            aria-label="Close onboarding"
          >
            ×
          </button>
        )}
      </div>

      <div className="space-y-2">
        {onboardingSteps.map((step) => (
          <div key={step.id} className="rounded-lg border border-blue-400/10 bg-slate-900/50 overflow-hidden">
            <button
              onClick={() => toggleStep(step.id)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-800/50 transition text-left"
              aria-expanded={expandedSteps.has(step.id)}
            >
              <span className="text-blue-400">{step.icon}</span>
              <div className="flex-1">
                <p className="font-semibold text-white text-sm">{step.title}</p>
                <p className="text-xs text-slate-500">{step.description}</p>
              </div>
              <ChevronDown
                className={`h-4 w-4 text-slate-500 shrink-0 transition-transform ${
                  expandedSteps.has(step.id) ? "rotate-180" : ""
                }`}
              />
            </button>

            {expandedSteps.has(step.id) && (
              <div className="border-t border-blue-400/10 px-4 py-3 bg-slate-900/30">
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
        ))}
      </div>

      {isFirstListing && (
        <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-400/20 rounded-lg">
          <p className="text-xs text-emerald-300 leading-relaxed">
            Once all required fields are complete and your listing looks good, you can publish. Buyers will discover your prompt in the marketplace and can securely purchase and unlock your content.
          </p>
        </div>
      )}
    </div>
  );
}
