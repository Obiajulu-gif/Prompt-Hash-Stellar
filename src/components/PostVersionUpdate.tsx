import { useState } from "react";
import { History, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  promptId: string;
  promptTitle: string;
  walletAddress: string;
  currentVersion: number;
  onSuccess?: (newVersion: number) => void;
}

export function PostVersionUpdate({ promptId, promptTitle, walletAddress, currentVersion, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const submit = async () => {
    if (!content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/prompts/version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId, walletAddress, content, changeNote }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to post version."); return; }
      setDone(data.versionIndex);
      setContent("");
      setChangeNote("");
      onSuccess?.(data.versionIndex);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        className="h-9 border-white/15 bg-white/[0.03] text-slate-300 hover:bg-white/10"
        onClick={() => setOpen(true)}
      >
        <History className="h-4 w-4" />
        Post update (v{currentVersion})
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        <History className="h-4 w-4 text-amber-300" />
        Post new version for <span className="text-amber-200">{promptTitle}</span>
        <span className="ml-auto text-xs text-slate-500">Current: v{currentVersion}</span>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-300/25 bg-rose-400/10 px-4 py-2.5 text-sm text-rose-100">
          {error}
        </div>
      )}

      {done && (
        <div className="rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-4 py-2.5 text-sm text-emerald-100">
          Version v{done} posted. Past buyers keep access to the version they purchased.
        </div>
      )}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Paste the updated prompt content here…"
        rows={6}
        className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-300/40 resize-y"
      />

      <Input
        value={changeNote}
        onChange={(e) => setChangeNote(e.target.value)}
        placeholder="What changed? (optional)"
        className="h-9 border-white/10 bg-white/[0.04] text-slate-100"
      />

      <div className="flex gap-2">
        <Button
          className="h-9 bg-amber-300 text-slate-950 hover:bg-amber-200 disabled:opacity-50"
          onClick={() => void submit()}
          disabled={busy || !content.trim()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Publish v{currentVersion + 1}
        </Button>
        <Button
          variant="outline"
          className="h-9 border-white/15 bg-white/[0.03] text-slate-300 hover:bg-white/10"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
