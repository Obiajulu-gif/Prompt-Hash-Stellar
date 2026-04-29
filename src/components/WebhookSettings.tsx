import { useState } from "react";
import { Globe, Loader2, PlugZap, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface WebhookInfo {
  _id: string;
  url: string;
  events: string[];
  active: boolean;
  lastDeliveredAt: string | null;
}

interface Props {
  walletAddress: string;
}

export function WebhookSettings({ walletAddress }: Props) {
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState<WebhookInfo | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/webhooks?walletAddress=${encodeURIComponent(walletAddress)}`);
      if (res.status === 404) {
        setSaved(null);
      } else if (res.ok) {
        const data = await res.json();
        setSaved(data);
        setUrl(data.url ?? "");
      } else {
        const data = await res.json();
        setError(data.error ?? "Failed to load webhook.");
      }
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, url }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save."); return; }
      setSecret(data.secret);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!saved) return;
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/webhooks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress }),
      });
      setSaved(null);
      setUrl("");
      setSecret(null);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-400/10 text-violet-300">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Webhook Notifications</h3>
            <p className="text-xs text-slate-400">Receive a POST request when your prompt is sold.</p>
          </div>
        </div>
        <Button
          className="h-9 bg-violet-500 text-white hover:bg-violet-400"
          onClick={() => void load()}
          disabled={busy}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          Load webhook settings
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-400/10 text-violet-300">
          <Globe className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-white">Webhook Notifications</h3>
          <p className="text-xs text-slate-400">
            {saved ? (saved.active ? "Active — receiving PromptPurchased events." : "Disabled after repeated failures.") : "No webhook registered yet."}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-300/25 bg-rose-400/10 px-4 py-2.5 text-sm text-rose-100">
          {error}
        </div>
      )}

      {secret && (
        <div className="rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100 space-y-1">
          <p className="font-medium">Webhook secret — save this now, it won't be shown again.</p>
          <code className="block break-all font-mono text-xs text-emerald-200">{secret}</code>
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-server.com/webhook"
          className="h-10 border-white/10 bg-white/[0.04] text-slate-100 flex-1"
        />
        <Button
          className="h-10 shrink-0 bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-50"
          onClick={() => void save()}
          disabled={busy || !url}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saved ? "Update" : "Register"}
        </Button>
        {saved && (
          <Button
            variant="outline"
            className="h-10 shrink-0 border-white/15 bg-white/[0.03] text-rose-300 hover:bg-rose-400/10"
            onClick={() => void remove()}
            disabled={busy}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {saved && (
        <p className="text-xs text-slate-500">
          Events: {saved.events.join(", ")} ·{" "}
          {saved.lastDeliveredAt
            ? `Last delivered ${new Date(saved.lastDeliveredAt).toLocaleString()}`
            : "Not yet delivered"}
        </p>
      )}
    </div>
  );
}
