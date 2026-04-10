import { ArrowUpRight, LockKeyhole, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { shortenAddress } from "@/lib/utils";
import { formatPriceLabel } from "@/lib/stellar/format";
import type { PromptRecord } from "@/lib/stellar/promptHashClient";

export const PromptCard = ({
  prompt,
  hasAccess,
  openModal,
}: {
  prompt: PromptRecord;
  hasAccess: boolean;
  openModal: (prompt: PromptRecord) => void;
}) => {
  return (
    <Card className="group overflow-hidden border-white/10 bg-slate-950/70 text-white shadow-[0_24px_80px_-48px_rgba(34,197,94,0.4)]">
      <div className="relative aspect-video overflow-hidden">
        <img
          src={prompt.imageUrl || "/images/codeguru.png"}
          alt={prompt.title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <Badge className="absolute right-3 top-3 bg-slate-950/85 text-emerald-200">
          {prompt.category}
        </Badge>
      </div>
      <CardContent className="space-y-4 p-5">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            Preview only
          </div>
          <h3 className="text-xl font-semibold">{prompt.title}</h3>
          <p className="line-clamp-4 text-sm leading-6 text-slate-300">
            {prompt.previewText}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Seller
            </p>
            <p className="mt-1 font-medium text-slate-100">
              {shortenAddress(prompt.creator)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Sales
            </p>
            <p className="mt-1 font-medium text-slate-100">{prompt.salesCount}</p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-3 p-5 pt-0">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
            License price
          </p>
          <p className="mt-1 text-xl font-semibold text-white">
            {formatPriceLabel(prompt.priceStroops)}
          </p>
        </div>
        <Button
          className="bg-emerald-400 text-slate-950 hover:bg-emerald-300"
          onClick={() => openModal(prompt)}
        >
          {hasAccess ? (
            <>
              <ArrowUpRight className="mr-2 h-4 w-4" />
              View full prompt
            </>
          ) : (
            <>
              <LockKeyhole className="mr-2 h-4 w-4" />
              Buy access
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};
