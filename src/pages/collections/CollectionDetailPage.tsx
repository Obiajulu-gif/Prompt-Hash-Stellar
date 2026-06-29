import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  LibraryBig,
  Loader2,
  PackageOpen,
  ShoppingBag,
  User,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { collections } from "@/data/collections";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { getPrompt } from "@/lib/stellar/promptHashClient";
import { formatPriceLabel } from "@/lib/stellar/format";
import { shortenAddress } from "@/lib/utils";
import { usePageMeta } from "@/lib/seo/usePageMeta";

export default function CollectionDetailPage() {
  const { id = "" } = useParams();
  const collection = collections.find((c) => c.id === id);

  usePageMeta({
    title: collection ? collection.title : "Collection",
    description:
      collection?.description ?? "Browse curated prompt collections.",
  });

  const { data: prompts, isLoading } = useQuery({
    queryKey: ["collection-prompts", id, collection?.promptIds],
    queryFn: async () => {
      if (!collection || collection.promptIds.length === 0) return [];
      const results = await Promise.allSettled(
        collection.promptIds.map((pid) =>
          getPrompt(browserStellarConfig, BigInt(pid)),
        ),
      );
      return results
        .filter(
          (
            r,
          ): r is PromiseFulfilledResult<
            Awaited<ReturnType<typeof getPrompt>>
          > => r.status === "fulfilled",
        )
        .map((r) => r.value);
    },
    enabled: Boolean(collection && collection.promptIds.length > 0),
  });

  if (!collection) {
    return (
      <div className="min-h-screen bg-[#020617] text-white">
        <Navigation />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="mb-6 -ml-2 text-slate-400 hover:text-white"
          >
            <Link to="/collections">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to collections
            </Link>
          </Button>
          <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
            <div className="max-w-sm">
              <PackageOpen className="mx-auto h-12 w-12 text-slate-500" />
              <h1 className="mt-4 text-xl font-semibold text-white">
                Collection not found
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                This collection may have been removed or the link is incorrect.
              </p>
              <Button
                asChild
                className="mt-5 h-9 bg-emerald-500 px-5 text-slate-950 hover:bg-emerald-400"
              >
                <Link to="/collections">
                  <LibraryBig className="h-4 w-4" />
                  Browse collections
                </Link>
              </Button>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] text-white selection:bg-emerald-500/30">
      <Navigation />

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-16 sm:px-6">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mb-6 -ml-2 text-slate-400 hover:text-white"
        >
          <Link to="/collections">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to collections
          </Link>
        </Button>

        <section className="mb-12">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f1419]">
            <div className="aspect-[1200/400] w-full overflow-hidden bg-slate-900">
              <img
                src={collection.imageUrl}
                alt={collection.title}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="space-y-4 p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                  {collection.promptCount} prompt
                  {collection.promptCount !== 1 ? "s" : ""}
                </Badge>
                <Badge className="border-white/10 bg-white/[0.05] text-slate-300">
                  <User className="mr-1 h-3 w-3" />
                  Curated by {collection.curator}
                </Badge>
              </div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {collection.title}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-slate-400">
                {collection.description}
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-2xl font-bold text-white">
            Included Prompts
          </h2>

          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02]">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : !prompts || prompts.length === 0 ? (
            <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
              <div className="max-w-sm">
                <PackageOpen className="mx-auto h-10 w-10 text-slate-500" />
                <h3 className="mt-3 text-lg font-semibold text-white">
                  No prompts in this collection
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  Prompts will appear here once they are added to this
                  collection.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {prompts.map((prompt) => (
                <Link
                  key={prompt.id.toString()}
                  to={`/prompts/${prompt.id.toString()}`}
                  className="group block"
                >
                  <Card className="overflow-hidden border-white/10 bg-white/[0.02] transition-all duration-300 hover:-translate-y-1 hover:border-emerald-500/30 hover:bg-white/[0.04]">
                    <div className="relative aspect-[16/10] overflow-hidden">
                      <img
                        src={prompt.imageUrl || "/images/codeguru.png"}
                        alt={prompt.title}
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent opacity-60" />
                      <div className="absolute bottom-3 left-3 flex gap-2">
                        <Badge className="bg-slate-950/80 backdrop-blur-md border-white/10 text-slate-200">
                          {prompt.category}
                        </Badge>
                      </div>
                    </div>
                    <CardContent className="p-4">
                      <h3 className="font-bold text-white transition-colors group-hover:text-emerald-400">
                        {prompt.title}
                      </h3>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm text-slate-400">
                          {shortenAddress(prompt.creator)}
                        </span>
                        <span className="font-mono text-sm font-bold text-emerald-400">
                          {formatPriceLabel(prompt.priceStroops)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="mt-12 text-center">
          <Button
            asChild
            className="h-11 bg-emerald-500 px-8 text-slate-950 hover:bg-emerald-400"
          >
            <Link to="/browse">
              <ShoppingBag className="mr-2 h-4 w-4" />
              Browse all marketplace prompts
            </Link>
          </Button>
        </div>
      </main>

      <Footer />
    </div>
  );
}
