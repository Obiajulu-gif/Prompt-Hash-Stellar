import { useState } from "react";
import { PlusCircle, LayoutList } from "lucide-react";
import { Footer } from "@/components/footer";
import { Navigation } from "@/components/navigation";
import { CreatePromptForm } from "./CreatePromptForm";
import MyPrompts from "./MyPrompts";

type View = "create" | "manage";

export default function SellPage() {
  const [view, setView] = useState<View>("create");

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_35%),linear-gradient(180deg,_#020617,_#0f172a_45%,_#020617)] text-white">
      <Navigation />

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {/* Hero */}
        <section className="mb-10 rounded-[2rem] border border-white/10 bg-slate-950/60 px-8 py-10 shadow-[0_32px_120px_-64px_rgba(16,185,129,0.4)]">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-400">
            Creator Studio
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-snug sm:text-4xl">
            Sell encrypted prompt licenses
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
            Your full prompt is encrypted in the browser before anything touches the
            blockchain. Buyers only see plaintext after an on-chain access check and
            wallet-authenticated unlock — you keep creative control.
          </p>

          {/* How it works pills */}
          <div className="mt-6 flex flex-wrap gap-3">
            {[
              { step: "1", label: "Write & encrypt" },
              { step: "2", label: "Set price on-chain" },
              { step: "3", label: "Buyers unlock with wallet" },
            ].map(({ step, label }) => (
              <div
                key={step}
                className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-1.5 text-xs text-emerald-200"
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400/20 text-[10px] font-bold text-emerald-300">
                  {step}
                </span>
                {label}
              </div>
            ))}
          </div>
        </section>

        {/* View switcher */}
        <div className="mb-8 flex gap-2 rounded-2xl border border-white/10 bg-slate-950/60 p-1.5">
          <button
            onClick={() => setView("create")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
              view === "create"
                ? "bg-emerald-500/20 text-emerald-300 shadow-inner"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <PlusCircle className="h-4 w-4" />
            Create listing
          </button>
          <button
            onClick={() => setView("manage")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
              view === "manage"
                ? "bg-emerald-500/20 text-emerald-300 shadow-inner"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <LayoutList className="h-4 w-4" />
            My prompts
          </button>
        </div>

        {view === "create" ? (
          <CreatePromptForm onCreated={() => setView("manage")} />
        ) : (
          <MyPrompts onCreateNew={() => setView("create")} />
        )}
      </main>

      <Footer />
    </div>
  );
}
