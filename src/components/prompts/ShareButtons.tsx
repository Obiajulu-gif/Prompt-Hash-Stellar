import { useEffect, useState } from "react";
import { Check, Link2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard/secureClipboard";

interface ShareButtonsProps {
  /** Title of the prompt — used to seed the share text. */
  title: string;
  /**
   * Canonical URL to share. Defaults to the current page location so the link
   * always points back to the marketplace listing.
   */
  url?: string;
  /** Optional extra context appended to the share text. */
  summary?: string;
  className?: string;
}

/** Brand glyph for X (formerly Twitter). Inlined to avoid brand-icon churn. */
function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Brand glyph for LinkedIn. */
function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

/**
 * Resolves the URL to share, falling back to the current browser location when
 * no explicit URL is supplied.
 */
function resolveShareUrl(url?: string): string {
  if (url) return url;
  if (typeof window !== "undefined") return window.location.href;
  return "";
}

/**
 * Social sharing controls for a prompt listing. Renders Twitter/X and LinkedIn
 * intents, a copy-link fallback, and the native Web Share sheet when the device
 * supports it (mobile / PWA).
 */
export function ShareButtons({ title, url, summary, className }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  const shareUrl = resolveShareUrl(url);
  const shareText = `${title} on Prompt Hash Stellar`;

  // navigator.share is only available in secure contexts on supporting devices,
  // so detect it on the client to avoid showing a button that would throw.
  useEffect(() => {
    setCanNativeShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    );
  }, []);

  const twitterHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    shareText,
  )}&url=${encodeURIComponent(shareUrl)}`;

  const linkedInHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
    shareUrl,
  )}`;

  const handleCopy = async () => {
    const result = await copyToClipboard(shareUrl);
    if (result.success) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleNativeShare = async () => {
    try {
      await navigator.share({
        title,
        text: summary ? `${shareText} — ${summary}` : shareText,
        url: shareUrl,
      });
    } catch {
      // User dismissed the share sheet or the platform aborted — no-op.
    }
  };

  return (
    <div
      className={className}
      role="group"
      aria-label="Share this prompt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={twitterHref}
          target="_blank"
          rel="noreferrer"
          aria-label="Share on X (Twitter)"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
        >
          <XIcon />
          <span className="hidden sm:inline">Post</span>
        </a>

        <a
          href={linkedInHref}
          target="_blank"
          rel="noreferrer"
          aria-label="Share on LinkedIn"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
        >
          <LinkedInIcon />
          <span className="hidden sm:inline">LinkedIn</span>
        </a>

        {canNativeShare && (
          <Button
            type="button"
            variant="ghost"
            onClick={handleNativeShare}
            aria-label="Share via device"
            className="h-9 border border-white/10 text-slate-200 hover:bg-white/10"
          >
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">Share</span>
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          onClick={handleCopy}
          aria-label="Copy share link"
          className="h-9 border border-white/10 text-slate-200 hover:bg-white/10"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-emerald-400" />
              <span className="hidden sm:inline">Copied</span>
            </>
          ) : (
            <>
              <Link2 className="h-4 w-4" />
              <span className="hidden sm:inline">Copy link</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
