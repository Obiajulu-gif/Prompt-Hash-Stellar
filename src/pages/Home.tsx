import { Link } from "react-router-dom";
import { ArrowRight, LockKeyhole, ShoppingBag, Sparkles } from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { FeaturedPrompts } from "@/components/featured-prompts";
import { Button } from "@/components/ui/button";

const stats = [
  {
    label: "Encrypted on-chain",
    value: "AES-GCM",
    body: "Full prompts are encrypted in the browser before they ever touch Stellar.",
  },
  {
    label: "License sales",
    value: "Multi-buyer",
    body: "Creators keep ownership while any number of buyers can purchase access rights.",
  },
  {
    label: "Deploy shape",
    value: "One Vercel app",
    body: "Static Vite frontend plus unlock/auth serverless functions in a single deployment.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.18),_transparent_26%),linear-gradient(180deg,_#020617,_#0f172a_45%,_#020617)] text-white">
      <Navigation />
      <main>
        <section className="mx-auto grid max-w-7xl gap-8 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <p className="text-sm uppercase tracking-[0.4em] text-amber-300">
              PromptHash on Stellar
            </p>
            <h1 className="max-w-4xl text-5xl font-semibold leading-tight sm:text-6xl">
              Sell prompt licenses, not one-time NFTs.
            </h1>
            <p className="max-w-2xl text-base leading-8 text-slate-300">
              Creators publish previews and encrypted prompt payloads on Stellar
              testnet. Buyers purchase access in XLM, prove wallet ownership with
              SEP-43 signing, and unlock plaintext only after the contract confirms
              their license.
            </p>
            <div className="flex flex-wrap gap-3">
            <Button asChild className="relative z-50 bg-amber-400 text-slate-950 hover:bg-amber-300 cursor-pointer">
              <Link to="/browse">
                Browse marketplace
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="relative z-50 border-white/15 bg-white/5 text-slate-100 hover:bg-white/10 cursor-pointer">
              <Link to="/sell">
                Create listing
              </Link>
            </Button>
            </div>
          </div>

          <div className="grid gap-4 rounded-[2rem] border border-white/10 bg-slate-950/60 p-6 shadow-[0_32px_120px_-64px_rgba(245,158,11,0.55)]">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5"
              >
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                  {stat.label}
                </p>
                <p className="mt-3 text-3xl font-semibold text-white">
                  {stat.value}
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {stat.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6">
          <div className="grid gap-6 rounded-[2rem] border border-white/10 bg-slate-950/60 p-8 lg:grid-cols-3">
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-6">
              <LockKeyhole className="h-8 w-8 text-emerald-300" />
              <h2 className="mt-4 text-2xl font-semibold">Secure unlock flow</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Wallet signs a short-lived challenge, the API checks `has_access`
                on-chain, then decrypts the stored ciphertext server-side.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-6">
              <ShoppingBag className="h-8 w-8 text-amber-300" />
              <h2 className="mt-4 text-2xl font-semibold">Creator-first economics</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Listings stay attached to the creator forever. Buyers get prompt
                access rights, and the contract tracks exact fee splits in stroops.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-6">
              <Sparkles className="h-8 w-8 text-cyan-300" />
              <h2 className="mt-4 text-2xl font-semibold">Curated prompt pack</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Explore fresh template examples for software, marketing, finance,
                product, and other operator workflows before browsing live listings.
              </p>
            </div>
          </div>
        </section>

        <FeaturedPrompts />
      </main>
      <Footer />
    </div>
  );
}
