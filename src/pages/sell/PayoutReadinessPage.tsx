/**
 * PayoutReadinessPage - Dedicated page for creators to check and complete payout setup
 */

import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { PayoutReadinessChecklist } from "@/components/sell/PayoutReadinessChecklist";
import { PayoutReadinessBanner } from "@/components/sell/PayoutReadinessBanner";
import { usePageMeta } from "@/lib/seo/usePageMeta";
import { useWallet } from "@/hooks/useWallet";

export default function PayoutReadinessPage() {
  usePageMeta({
    title: "Payout Readiness Check",
    description: "Complete your payout setup to publish paid prompts on PromptHash Stellar.",
  });

  const { address } = useWallet();

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_60%_40%_at_0%_0%,rgba(34,211,238,0.1),transparent),radial-gradient(ellipse_50%_30%_at_100%_5%,rgba(251,191,36,0.07),transparent),linear-gradient(180deg,#080b0f_0%,#0d1117_50%,#080b0f_100%)] text-white">
      <Navigation />

      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        {/* Header */}
        <div className="mb-8">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="mb-6 -ml-2 text-slate-400 hover:text-white"
          >
            <Link to="/sell">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to Create Prompt
            </Link>
          </Button>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-400">
              Creator Requirements
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Payout Readiness Check
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Complete the setup below to publish paid prompts and receive earnings from buyers.
            </p>
          </div>
        </div>

        {/* Quick Status Banner */}
        <PayoutReadinessBanner showWhenReady className="mb-8" />

        {!address ? (
          /* Not connected state */
          <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
            <div className="max-w-sm">
              <div className="mx-auto h-12 w-12 rounded-full bg-slate-800 flex items-center justify-center mb-4">
                <ExternalLink className="h-6 w-6 text-slate-500" />
              </div>
              <h2 className="text-xl font-semibold text-white">
                Connect your wallet
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Connect a Stellar wallet to check your payout readiness and manage creator settings.
              </p>
              <Button
                onClick={() => {
                  // Trigger wallet connection - this would be handled by the Navigation component
                  const connectButton = document.querySelector('[data-testid="connect-wallet"]') as HTMLButtonElement;
                  connectButton?.click();
                }}
                className="mt-4"
                variant="outline"
              >
                Connect Wallet
              </Button>
            </div>
          </div>
        ) : (
          /* Connected state - show full checklist */
          <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
            <div>
              <PayoutReadinessChecklist />
            </div>

            {/* Sidebar with resources */}
            <div className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                <h3 className="font-semibold text-white mb-4">
                  Getting Started Resources
                </h3>
                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-medium text-slate-300 mb-1">
                      Creator Onboarding Guide
                    </h4>
                    <p className="text-xs text-slate-400 mb-2">
                      Step-by-step walkthrough for new creators
                    </p>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs w-full justify-between"
                    >
                      <a
                        href="/docs/creator-onboarding"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Read Guide
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-slate-300 mb-1">
                      Get XLM for Fees
                    </h4>
                    <p className="text-xs text-slate-400 mb-2">
                      Fund your wallet with XLM for transactions
                    </p>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs w-full justify-between"
                    >
                      <a
                        href="https://stellar.org/developers/reference/testnet"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Get Testnet XLM
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-slate-300 mb-1">
                      Pricing Your Prompts
                    </h4>
                    <p className="text-xs text-slate-400 mb-2">
                      Best practices for setting competitive prices
                    </p>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs w-full justify-between"
                    >
                      <Link to="/sell">
                        View Pricing Tips
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-4">
                <h3 className="text-sm font-semibold text-emerald-100 mb-2">
                  🎉 Ready to Earn?
                </h3>
                <p className="text-xs text-emerald-200/80 mb-3">
                  Once your payout setup is complete, you can start publishing paid prompts and earning XLM from buyers.
                </p>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs w-full border-emerald-400/20 text-emerald-300 hover:bg-emerald-500/10"
                >
                  <Link to="/sell">
                    Create Your First Prompt
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Help Section */}
        <div className="mt-12 pt-8 border-t border-white/10">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-white mb-2">
              Need Help Getting Set Up?
            </h2>
            <p className="text-sm text-slate-400 mb-4 max-w-2xl mx-auto">
              Our creator community and support team are here to help you get started with confidence.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                asChild
                variant="outline"
                size="sm"
              >
                <a
                  href="https://github.com/your-repo/discussions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  Community Support
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
              >
                <a
                  href="mailto:support@prompthash.com"
                  className="flex items-center gap-2"
                >
                  Email Support
                </a>
              </Button>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}