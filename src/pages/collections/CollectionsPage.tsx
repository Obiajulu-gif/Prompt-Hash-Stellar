import { Link } from "react-router-dom";
import { ArrowRight, LibraryBig, PackageOpen } from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { collections } from "@/data/collections";
import { usePageMeta } from "@/lib/seo/usePageMeta";

export default function CollectionsPage() {
  usePageMeta({
    title: "Collections",
    description:
      "Browse curated collections of premium AI prompt licenses on the Stellar blockchain.",
  });

  return (
    <div className="min-h-screen bg-[#020617] text-white selection:bg-emerald-500/30">
      <Navigation />

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-16 sm:px-6">
        <section className="mb-12 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-400">
            Curated Selections
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Prompt Collections
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-400">
            Hand-picked groups of prompt licenses organised by theme, use case,
            and creator expertise.
          </p>
        </section>

        {collections.length === 0 ? (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
            <div className="max-w-sm">
              <PackageOpen className="mx-auto h-12 w-12 text-slate-500" />
              <h3 className="mt-4 text-xl font-semibold text-white">
                No collections yet
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Curated collections will appear here once they are created.
              </p>
              <Button
                asChild
                className="mt-6 h-10 bg-emerald-500 px-6 text-slate-950 hover:bg-emerald-400"
              >
                <Link to="/browse">
                  <LibraryBig className="mr-2 h-4 w-4" />
                  Browse marketplace
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((collection) => (
              <Link
                key={collection.id}
                to={`/collections/${collection.id}`}
                className="group block"
              >
                <Card className="overflow-hidden border-white/10 bg-white/[0.02] transition-all duration-300 hover:-translate-y-1 hover:border-emerald-500/30 hover:bg-white/[0.04]">
                  <div className="relative aspect-[16/9] overflow-hidden">
                    <img
                      src={collection.imageUrl}
                      alt={collection.title}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent opacity-70" />
                    <div className="absolute bottom-4 left-4 right-4">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                          {collection.promptCount} prompt
                          {collection.promptCount !== 1 ? "s" : ""}
                        </Badge>
                        <Badge className="bg-slate-950/80 text-slate-300 border-white/10 backdrop-blur-sm">
                          {collection.curator}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-bold text-white transition-colors group-hover:text-emerald-400">
                          {collection.title}
                        </h3>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">
                          {collection.description}
                        </p>
                      </div>
                      <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-slate-600 transition-colors group-hover:text-emerald-400" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
