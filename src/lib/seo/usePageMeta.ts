import { useEffect } from "react";

interface PageMetaOptions {
  title: string;
  description?: string;
  ogImage?: string;
  /** Canonical URL for the page. Defaults to the current location. */
  url?: string;
  /** Open Graph object type (e.g. "website", "article"). Defaults to "website". */
  type?: string;
}

const SITE_NAME = "Prompt Hash Stellar";
const DEFAULT_DESCRIPTION =
  "Buy and sell AI prompts securely on the Stellar blockchain. Wallet-verified access, on-chain ownership.";
const DEFAULT_OG_IMAGE = "/og-image.png";

function setMeta(nameOrProperty: string, content: string, isProperty = false) {
  const attr = isProperty ? "property" : "name";
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${nameOrProperty}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, nameOrProperty);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/** Resolves a relative path to an absolute URL so crawlers receive a usable link. */
function absoluteUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  if (typeof window !== "undefined") {
    try {
      return new URL(value, window.location.origin).toString();
    } catch {
      return value;
    }
  }
  return value;
}

export function usePageMeta({ title, description, ogImage, url, type }: PageMetaOptions) {
  useEffect(() => {
    const fullTitle = `${title} | ${SITE_NAME}`;
    const desc = description ?? DEFAULT_DESCRIPTION;
    const image = absoluteUrl(ogImage ?? DEFAULT_OG_IMAGE);
    const ogType = type ?? "website";
    const canonical =
      url ?? (typeof window !== "undefined" ? window.location.href : undefined);

    document.title = fullTitle;

    setMeta("description", desc);
    setMeta("og:title", fullTitle, true);
    setMeta("og:description", desc, true);
    setMeta("og:image", image, true);
    setMeta("og:type", ogType, true);
    setMeta("og:site_name", SITE_NAME, true);
    if (canonical) {
      setMeta("og:url", canonical, true);
    }
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", fullTitle);
    setMeta("twitter:description", desc);
    setMeta("twitter:image", image);

    return () => {
      document.title = SITE_NAME;
    };
  }, [title, description, ogImage, url, type]);
}
