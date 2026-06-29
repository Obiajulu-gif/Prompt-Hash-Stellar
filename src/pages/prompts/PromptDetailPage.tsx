import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Copy,
  History,
  Loader2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  User,
} from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { getPrompt } from "@/lib/stellar/promptHashClient";
import { formatPriceLabel } from "@/lib/stellar/format";
import { copyToClipboard } from "@/lib/clipboard/secureClipboard";
import { usePageMeta } from "@/lib/seo/usePageMeta";
import { PromptRevisionHistory } from "@/components/analytics/PromptRevisionHistory";
import { MarkdownContent } from "@/components/MarkdownContent";

const FALLBACK_IMAGE = "/images/codeguru.png";

function summarise(text: string, max = 160): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export default function PromptDetailPage() {
  const { id = "" } = useParams();
  const isValidId = /^\d+$/.test(id);
  const [copied, setCopied] = useState(false);

  const {
    data: prompt,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["prompt-detail", id],
    queryFn: () => getPrompt(browserStellarConfig, BigInt(id)),
    enabled: isValidId,
  });

  // Drive the share preview (Open Graph / Twitter card) from the prompt details
  // so links shared to social platforms show the title, summary and cover image.
  const summary = prompt
    ? summarise(prompt.description || prompt.previewText)
    : "Discover wallet-verified AI prompts secured on the Stellar blockchain.";
  usePageMeta({
    title: prompt ? prompt.title : "Prompt",
    description: summary,
    ogImage: prompt?.imageUrl || undefined,
    type: "article",
  });

  const handleCopyLink = async () => {
    const link =
      typeof window !== "undefined" ? window.location.href : `/prompts/${id}`;
    const result = await copyToClipboard(link);
    if (result.success) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const notFound = !isValidId || isError || (!isLoading && !prompt);

  return (
    <div className="min-h-screen bg-[#020617] text-white selection:bg-cyan-500/30">
      <Navigation />

      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mb-6 -ml-2 text-slate-400 hover:text-white"
        >
          <Link to="/browse">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to marketplace
          </Link>
        </Button>

        {isLoading && isValidId ? (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02]">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : notFound || !prompt ? (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
            <div className="max-w-sm">
              <h1 className="text-xl font-semibold text-white">
                Prompt not found
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                This prompt may have been removed or the link is incorrect.
              </p>
              <Button
                asChild
                className="mt-5 h-9 bg-cyan-200 px-5 text-slate-950 hover:bg-cyan-100"
              >
                <Link to="/browse">
                  <ShoppingBag className="h-4 w-4" />
                  Browse marketplace
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <article className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f1419]">
            <div className="aspect-[1200/630] w-full overflow-hidden bg-slate-900">
              <img
                src={prompt.imageUrl || FALLBACK_IMAGE}
                alt={prompt.title}
                className="h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.src = FALLBACK_IMAGE;
                }}
              />
            </div>

            <div className="space-y-5 p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-cyan-200/30 bg-cyan-200/10 text-cyan-100">
                  <Sparkles className="mr-1 h-3 w-3" />
                  {prompt.category}
                </Badge>
                {prompt.active ? (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    title="This prompt is currently available for purchase"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Active
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20"
                    title="This prompt is not currently available for purchase"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                    Inactive
                  </span>
                )}
                {prompt.contentHash && (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    title="Content integrity verified on the Stellar blockchain"
                  >
                    <ShieldCheck className="h-3 w-3 text-amber-400" />
                    Verified
                  </span>
                )}
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20"
                  title={`${prompt.salesCount} license${prompt.salesCount !== 1 ? "s" : ""} sold`}
                >
                  <ShoppingBag className="h-3 w-3" />
                  {prompt.salesCount} sold
                </span>
              </div>

              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  {prompt.title}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {prompt.previewText}
                </p>
                {prompt.description && (
                  <div className="mt-4">
                    <MarkdownContent>{prompt.description}</MarkdownContent>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  <span className="font-mono text-slate-300">
                    {prompt.creator.length > 12
                      ? `${prompt.creator.slice(0, 6)}…${prompt.creator.slice(-4)}`
                      : prompt.creator}
                  </span>
                </span>
                <span className="font-semibold text-white">
                  {formatPriceLabel(prompt.priceStroops)}
                </span>
                {"revision" in prompt && prompt.revision !== undefined && (
                  <span className="inline-flex items-center gap-1.5">
                    <History className="h-3.5 w-3.5" />
                    v{prompt.revision}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row">
                <Button
                  asChild
                  className="h-10 flex-1 bg-cyan-200 text-slate-950 hover:bg-cyan-100"
                >
                  <Link to="/browse">
                    <ShoppingBag className="h-4 w-4" />
                    View in marketplace
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleCopyLink}
                  className="h-10 flex-1 border border-white/10 text-slate-200 hover:bg-white/10"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-400" />
                      Link copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy share link
                    </>
                  )}
                </Button>
              </div>
            </div>
          </article>
        )}
      </main>

      <Footer />
    </div>
  );
}
