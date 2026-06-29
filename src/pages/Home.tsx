import { Link } from "react-router-dom";
import {
  ArrowRight,
  LockKeyhole,
  ShoppingBag,
  Sparkles,
  Shield,
  Zap,
  Users,
  ChevronRight,
} from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { FeaturedPrompts } from "@/components/featured-prompts";
import { FeaturedCreators } from "@/components/FeaturedCreators";
import { Button } from "@/components/ui/button";
import { MarketplaceAnalyticsCards } from "@/components/analytics/MarketplaceAnalyticsCards";
import { usePageMeta } from "@/lib/seo/usePageMeta";
import { Web3Tooltip } from "@/components/Web3Tooltip";

const stats = [
  {
    label: "Encrypted on-chain",
    value: "AES-GCM",
    body: "Full prompts are encrypted in the browser before they ever touch Stellar.",
    icon: Shield,
  },
  {
    label: "License sales",
    value: "Multi-buyer",
    body: "Creators keep ownership while any number of buyers can purchase access rights.",
    icon: Users,
  },
  {
    label: "Instant settlement",
    value: <Web3Tooltip term="XLM">XLM Native</Web3Tooltip>,
    body: "Payments settle in seconds on Stellar with minimal fees.",
    icon: Zap,
  },
];

const steps = [
  {
    number: "01",
    title: "Create & Encrypt",
    description:
      "Write your prompt, encrypt it with AES-GCM in the browser, and publish the ciphertext on-chain.",
  },
  {
    number: "02",
    title: "List for Sale",
    description: (
      <>
        Set your price in <Web3Tooltip term="XLM">XLM</Web3Tooltip>, configure revenue splits, and make your prompt available to buyers.
      </>
    ),
  },
  {
    number: "03",
    title: "Earn & Transfer",
    description:
      "Buyers purchase access, you receive instant payment. Licenses can be resold with royalties.",
  },
];

export default function Home() {
  usePageMeta({
    title: "Marketplace",
    description:
      "Discover and purchase AI prompts secured on the Stellar blockchain. Wallet-verified access, on-chain ownership.",
  });

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.18),_transparent_26%),linear-gradient(180deg,_#020617,_#0f172a_45%,_#020617)] text-white">
      <Navigation />
      <main>
        {/* Hero Section */}
        <section className="relative overflow-hidden">
          {/* Background decoration */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-20 left-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
            <div className="absolute bottom-20 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
          </div>

          <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:py-28">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-amber-500/20 bg-amber-500/10">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="text-sm text-amber-300">
                  PromptHash on Stellar
                </span>
              </div>

              <h1 className="max-w-4xl text-5xl font-bold leading-[1.1] tracking-tight sm:text-6xl lg:text-7xl">
                Sell prompt licenses,{" "}
                <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                  not one-time NFTs.
                </span>
              </h1>

              <p className="max-w-2xl text-lg leading-relaxed text-slate-300">
                Creators publish previews and encrypted prompt payloads on
                Stellar. Buyers purchase access in <Web3Tooltip term="XLM">XLM</Web3Tooltip>, prove wallet ownership
                with <Web3Tooltip term="Sign Transaction">SEP-43 signing</Web3Tooltip>, and unlock plaintext only after the contract
                verifies payment.
              </p>

              <div className="flex flex-wrap gap-4">
                <Button
                  asChild
                  size="lg"
                  className="relative z-50 bg-amber-400 text-slate-950 hover:bg-amber-300 cursor-pointer font-semibold px-8"
                >
                  <Link to="/browse">
                    Browse marketplace
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="relative z-50 border-white/15 bg-white/5 text-slate-100 hover:bg-white/10 cursor-pointer px-8"
                >
                  <Link to="/sell">Start selling</Link>
                </Button>
              </div>

              {/* Trust indicators */}
              <div className="flex items-center gap-6 pt-4">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <span>AES-GCM encrypted</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>~5s settlement</span>
                </div>
              </div>
            </div>

            {/* Stats cards */}
            <div className="grid gap-4 rounded-[2rem] border border-white/10 bg-slate-950/60 p-6 shadow-[0_32px_120px_-64px_rgba(245,158,11,0.55)]">
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.label}
                    className="rounded-[1.5rem] border border-white/10 bg-white/5 p-6 transition-all hover:bg-white/8 hover:border-white/15"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <Icon className="w-5 h-5 text-amber-400" />
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                        {stat.label}
                      </p>
                    </div>
                    <p className="text-3xl font-bold text-white">{stat.value}</p>
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">
                      {stat.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="mx-auto max-w-7xl px-6 py-20">
          <div className="text-center mb-16">
            <p className="text-sm uppercase tracking-[0.3em] text-amber-300 mb-3">
              How it works
            </p>
            <h2 className="text-3xl font-bold text-white sm:text-4xl">
              Three steps to monetize your prompts
            </h2>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {steps.map((step, index) => (
              <div key={step.number} className="relative">
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-12 left-full w-full h-px bg-gradient-to-r from-amber-500/30 to-transparent" />
                )}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-8 hover:bg-white/8 transition-all">
                  <div className="text-5xl font-bold text-amber-500/20 mb-4">
                    {step.number}
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-3">
                    {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-300">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Marketplace Analytics */}
        <section className="mx-auto max-w-7xl px-6 py-8">
          <div className="mb-8">
            <p className="text-sm uppercase tracking-[0.3em] text-amber-300 mb-2">
              Live metrics
            </p>
            <h2 className="text-3xl font-bold text-white">Marketplace Overview</h2>
            <p className="mt-2 text-sm text-slate-400">
              Real-time metrics from the Stellar network
            </p>
          </div>
          <MarketplaceAnalyticsCards />
        </section>

        {/* Features */}
        <section className="mx-auto max-w-7xl px-6 py-20">
          <div className="grid gap-6 rounded-[2rem] border border-white/10 bg-slate-950/60 p-8 lg:grid-cols-3">
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-8 hover:bg-white/8 transition-all">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-6">
                <LockKeyhole className="h-6 w-6 text-emerald-300" />
              </div>
              <h2 className="text-xl font-semibold">Secure unlock flow</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                Wallet signs a short-lived challenge, the API checks
                `has_access` on-chain, then decrypts the stored ciphertext
                server-side.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-8 hover:bg-white/8 transition-all">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center mb-6">
                <ShoppingBag className="h-6 w-6 text-amber-300" />
              </div>
              <h2 className="text-xl font-semibold">Creator-first economics</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                Listings stay attached to the creator forever. Buyers get prompt
                access rights, and the contract tracks exact fee splits in
                stroops.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-8 hover:bg-white/8 transition-all">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center mb-6">
                <Sparkles className="h-6 w-6 text-cyan-300" />
              </div>
              <h2 className="text-xl font-semibold">Curated prompt pack</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                Explore fresh template examples for software, marketing, finance,
                product, and other operator workflows before browsing live
                listings.
              </p>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="mx-auto max-w-7xl px-6 py-20">
          <div className="rounded-[2rem] border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-orange-500/5 p-12 text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">
              Ready to monetize your AI prompts?
            </h2>
            <p className="mt-4 text-lg text-slate-300 max-w-2xl mx-auto">
              Join creators already earning XLM by selling encrypted prompt
              licenses on Stellar.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Button
                asChild
                size="lg"
                className="bg-amber-400 text-slate-950 hover:bg-amber-300 font-semibold px-8"
              >
                <Link to="/sell">
                  Start selling
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
              >
                <Link to="/browse">Explore marketplace</Link>
              </Button>
            </div>
          </div>
        </section>

        <FeaturedCreators />
        <FeaturedPrompts />
      </main>
      <Footer />
    </div>
  );
}
