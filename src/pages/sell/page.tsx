import { Footer } from "@/components/footer";
import { Navigation } from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreatePromptForm } from "./CreatePromptForm";
import MyPrompts from "./MyPrompts";

export default function SellPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.16),_transparent_30%),linear-gradient(180deg,_#020617,_#0f172a_45%,_#020617)] text-white">
      <Navigation />
      <main className="mx-auto max-w-7xl px-6 py-10">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/60 p-8 shadow-[0_32px_120px_-64px_rgba(16,185,129,0.45)]">
          <p className="text-sm uppercase tracking-[0.35em] text-emerald-300">
            Sell encrypted prompts
          </p>
          <h1 className="mt-4 text-4xl font-semibold">
            Create prompt listings without NFT transfer semantics.
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
            The browser encrypts full prompt content before submission. Buyers only
            receive plaintext after an on-chain access check and wallet-authenticated unlock.
          </p>
        </section>

        <div className="mt-10">
          <Tabs defaultValue="new" className="space-y-6">
            <TabsList className="grid w-full max-w-md grid-cols-2 border border-white/10 bg-slate-950/70">
              <TabsTrigger value="new">Create listing</TabsTrigger>
              <TabsTrigger value="listings">My prompts</TabsTrigger>
            </TabsList>

            <TabsContent value="new">
              <Card className="border-white/10 bg-slate-950/70 text-white">
                <CardHeader>
                  <CardTitle>Create a prompt listing</CardTitle>
                </CardHeader>
                <CardContent>
                  <CreatePromptForm />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="listings">
              <MyPrompts />
            </TabsContent>
          </Tabs>
        </div>
      </main>
      <Footer />
    </div>
  );
}
