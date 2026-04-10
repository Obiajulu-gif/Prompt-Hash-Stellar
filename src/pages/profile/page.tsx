import { Footer } from "@/components/footer";
import { Navigation } from "@/components/navigation";
import MyPrompts from "@/pages/sell/MyPrompts";

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.16),_transparent_30%),linear-gradient(180deg,_#020617,_#0f172a_45%,_#020617)] text-white">
      <Navigation />
      <main className="mx-auto max-w-7xl px-6 py-10">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/60 p-8 shadow-[0_32px_120px_-64px_rgba(16,185,129,0.45)]">
          <p className="text-sm uppercase tracking-[0.35em] text-emerald-300">
            Wallet profile
          </p>
          <h1 className="mt-4 text-4xl font-semibold">My prompt licenses</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
            Manage listings you created and reopen prompts you purchased. This
            page reads directly from the Stellar contract and uses the unlock API
            only when you request the decrypted plaintext.
          </p>
        </section>

        <section className="mt-10">
          <MyPrompts />
        </section>
      </main>
      <Footer />
    </div>
  );
}
