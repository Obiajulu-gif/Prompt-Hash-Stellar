import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, PackageSearch } from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { getAllPrompts, type PromptRecord } from "@/lib/stellar/promptHashClient";
import { formatPriceLabel } from "@/lib/stellar/format";
import { categoryMetadata, resolveCategoryName } from "@/data/categoryMetadata";
import { usePageMeta } from "@/lib/seo/usePageMeta";

export default function CategoryPage() {
  const { categoryName } = useParams<{ categoryName: string }>();
  const resolvedName = resolveCategoryName(categoryName ?? "");
  const meta = resolvedName ? categoryMetadata[resolvedName] : undefined;

  usePageMeta({
    title: meta ? `${meta.name} Prompts` : "Category",
    description: meta?.description ?? "Browse prompts in this category.",
  });

  const promptsQuery = useQuery({
    queryKey: ["marketplace-prompts"],
    queryFn: async () => {
      if (!browserStellarConfig.promptHashContractId) return [];
      return getAllPrompts(browserStellarConfig);
    },
  });

  const categoryPrompts = useMemo(() => {
    if (!resolvedName || !promptsQuery.data) return [];
    return promptsQuery.data.filter(
      (prompt) =>
        prompt.active && prompt.category.toLowerCase() === resolvedName.toLowerCase(),
    );
  }, [resolvedName, promptsQuery.data]);

  return (
    <div className="min-h-screen bg-[#020617] text-white selection:bg-emerald-500/30">
      <Navigation />

      {/* Category Hero */}
      <header className="relative overflow-hidden px-4 pb-16 pt-20 sm:px-6">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[300px] bg-emerald-500/10 blur-[120px] pointer-events-none" />

        <div className="mx-auto max-w-7xl relative">
          <Link
            to="/browse"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-emerald-400 transition-colors mb-8"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Browse
          </Link>

          {meta ? (
            <div className="max-w-3xl">
              <Badge className="mb-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 px-3 py-1 text-xs uppercase tracking-wider">
                {meta.name}
              </Badge>
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl mb-4 bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent leading-[1.1]">
                {meta.name} Prompts
              </h1>
              <p className="text-lg text-slate-400 leading-relaxed max-w-2xl">
                {meta.description}
              </p>
            </div>
          ) : (
            <div className="max-w-3xl">
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl mb-4 bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent leading-[1.1]">
                Category Not Found
              </h1>
              <p className="text-lg text-slate-400 leading-relaxed max-w-2xl">
                The category "{categoryName}" does not exist. Browse all available
                categories and prompts.
              </p>
              <Button className="mt-6 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold h-12 px-8 rounded-xl">
                <Link to="/browse">Browse All Prompts</Link>
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        {promptsQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-[400px] rounded-3xl border border-white/5 bg-white/[0.02] animate-pulse"
              />
            ))}
          </div>
        ) : categoryPrompts.length === 0 && meta ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
            <div className="p-4 rounded-full bg-slate-900 border border-white/5">
              <PackageSearch className="h-8 w-8 text-slate-500" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">No prompts in this category yet</h3>
              <p className="text-slate-500 max-w-[320px]">
                This category is still growing. Check back soon for new prompt
                listings, or browse other categories.
              </p>
            </div>
            <Link to="/browse">
              <Button
                variant="outline"
                className="mt-2 border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
              >
                Browse All Categories
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {categoryPrompts.map((prompt) => (
              <CategoryPromptCard key={prompt.id.toString()} prompt={prompt} />
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

function CategoryPromptCard({ prompt }: { prompt: PromptRecord }) {
  return (
    <Link to={`/prompts/${prompt.id.toString()}`}>
      <Card className="group relative flex flex-col border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-all duration-300 hover:-translate-y-1 cursor-pointer overflow-hidden rounded-[24px] h-full">
        <div className="relative aspect-[16/10] overflow-hidden">
          <img
            src={prompt.imageUrl || "/images/codeguru.png"}
            alt={prompt.title}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent opacity-60" />
        </div>
        <CardContent className="flex flex-1 flex-col p-4 sm:p-6">
          <div className="flex-1 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-bold leading-tight transition-colors group-hover:text-emerald-400 sm:text-lg">
                {prompt.title}
              </h3>
              <p className="text-lg font-black text-emerald-400 sm:text-xl font-mono tracking-tight shrink-0">
                {formatPriceLabel(prompt.priceStroops)}
              </p>
            </div>
            <p className="line-clamp-2 text-sm text-slate-400 leading-relaxed">
              {prompt.previewText}
            </p>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
            <Badge className="bg-slate-800 text-slate-300 border-none">
              {prompt.category}
            </Badge>
            <span>{prompt.salesCount} sales</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
