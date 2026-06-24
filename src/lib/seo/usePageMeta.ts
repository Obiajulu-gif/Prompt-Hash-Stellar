import { useEffect } from "react";

interface PageMetaOptions {
  title: string;
  description?: string;
  ogImage?: string;
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

export function usePageMeta({ title, description, ogImage }: PageMetaOptions) {
  useEffect(() => {
    const fullTitle = `${title} | ${SITE_NAME}`;
    const desc = description ?? DEFAULT_DESCRIPTION;
    const image = ogImage ?? DEFAULT_OG_IMAGE;

    document.title = fullTitle;

    setMeta("description", desc);
    setMeta("og:title", fullTitle, true);
    setMeta("og:description", desc, true);
    setMeta("og:image", image, true);
    setMeta("og:type", "website", true);
    setMeta("og:site_name", SITE_NAME, true);
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", fullTitle);
    setMeta("twitter:description", desc);
    setMeta("twitter:image", image);

    return () => {
      document.title = SITE_NAME;
    };
  }, [title, description, ogImage]);
}
