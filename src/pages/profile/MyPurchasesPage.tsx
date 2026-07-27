import { Link } from "react-router-dom";
import { ShoppingBag, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { BuyerLibrary } from "@/components/BuyerLibrary";

export default function MyPurchasesPage() {
  return (
    <div className="min-h-screen bg-[#020617] text-white selection:bg-cyan-500/30">
      <Navigation />

      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        {/* Page header */}
        <div className="mb-10">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="mb-6 -ml-2 text-slate-400 hover:text-white"
          >
            <Link to="/profile">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to profile
            </Link>
          </Button>

          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-200/10 text-cyan-100">
              <ShoppingBag className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                My Purchases
              </h1>
              <p className="mt-0.5 text-sm text-slate-400">
                All prompts whose license is owned by your connected wallet.
                Unlock any entry to retrieve the decrypted content.
              </p>
            </div>
          </div>
        </div>

        {/* Library grid — handles connect, wrong-network, loading, error, and empty states */}
        <BuyerLibrary />
      </main>

      <Footer />
    </div>
  );
}
