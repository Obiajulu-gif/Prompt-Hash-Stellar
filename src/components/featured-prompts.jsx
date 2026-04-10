import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { featuredPromptTemplates } from "@/data/featuredPrompts";
import { Button } from "./ui/button";
import { Card, CardContent, CardFooter } from "./ui/card";
import { Badge } from "./ui/badge";

export function FeaturedPrompts({ limit = 6, title = "Featured Templates" }) {
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const templates = featuredPromptTemplates.slice(0, limit);

  return (
    <>
      <section className="px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-2 text-sm uppercase tracking-[0.3em] text-amber-300">
                Curated starter pack
              </p>
              <h2 className="text-3xl font-semibold text-white">{title}</h2>
              <p className="mt-3 max-w-2xl text-sm text-slate-300">
                Freshly authored browse examples inspired by real operator workflows.
                These are templates for exploration. Live marketplace listings load from Stellar.
              </p>
            </div>
            <Link to="/browse">
              <Button
                variant="outline"
                className="border-white/15 bg-white/5 text-slate-100 hover:bg-white/10"
              >
                Browse marketplace
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((prompt) => (
              <Card
                key={prompt.id}
                className="overflow-hidden border-white/10 bg-slate-950/60 text-white shadow-[0_24px_80px_-48px_rgba(245,158,11,0.6)]"
              >
                <div className="relative aspect-video overflow-hidden">
                  <img
                    src={prompt.imageUrl}
                    alt={prompt.title}
                    className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                  />
                  <Badge className="absolute right-3 top-3 bg-slate-950/80 text-amber-200">
                    {prompt.category}
                  </Badge>
                </div>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center gap-2 text-amber-300">
                    <Sparkles className="h-4 w-4" />
                    <span className="text-xs uppercase tracking-[0.25em]">
                      Preview
                    </span>
                  </div>
                  <h3 className="text-xl font-semibold">{prompt.title}</h3>
                  <p className="text-sm leading-6 text-slate-300">
                    {prompt.previewText}
                  </p>
                </CardContent>
                <CardFooter className="p-5 pt-0">
                  <Button
                    className="w-full bg-amber-400 text-slate-950 hover:bg-amber-300"
                    onClick={() => setSelectedPrompt(prompt)}
                  >
                    View template
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {selectedPrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-3xl border border-white/10 bg-slate-950 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-amber-300">
                  {selectedPrompt.category}
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  {selectedPrompt.title}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-slate-200 hover:bg-white/10"
                onClick={() => setSelectedPrompt(null)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="grid gap-6 p-6 lg:grid-cols-[1.1fr_0.9fr]">
              <img
                src={selectedPrompt.imageUrl}
                alt={selectedPrompt.title}
                className="aspect-video w-full rounded-2xl object-cover"
              />
              <div className="space-y-5">
                <div>
                  <h4 className="text-sm uppercase tracking-[0.25em] text-slate-400">
                    Public preview
                  </h4>
                  <p className="mt-3 text-sm leading-6 text-slate-200">
                    {selectedPrompt.previewText}
                  </p>
                </div>
                <div>
                  <h4 className="text-sm uppercase tracking-[0.25em] text-slate-400">
                    Full template example
                  </h4>
                  <pre className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-200">
                    {selectedPrompt.fullPrompt}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
