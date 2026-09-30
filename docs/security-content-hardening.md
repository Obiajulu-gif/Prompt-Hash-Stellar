# Security Hardening: Untrusted Content & External URLs

## Overview

In Prompt Hash Stellar, user-supplied content originates from multiple untrusted sources:
- Creator listing descriptions, prompt markdown previews, and update changelogs
- Creator profile bios, website URLs, and social media handles
- External URLs for documentation, Stellar transaction explorers, and IPFS metadata

To prevent Cross-Site Scripting (XSS), open redirects, protocol abuse, and phishing via misleading outbound links, this repository enforces strict sanitization on both server and client layers (#808).

---

## 1. Allowed & Blocked Protocols

External URLs (links in markdown, seller profile websites, explorer references) must adhere to the following protocol restrictions:

| Context | Permitted Protocols | Blocked Protocols |
| :--- | :--- | :--- |
| **Outbound Links** | `https:`, `http:` | `javascript:`, `vbscript:`, `data:`, `file:`, `blob:`, `about:` |
| **Markdown Images** | `https:` only | `http:`, `data:`, `blob:`, `javascript:`, relative paths |

### Deception & Protocol Evasion Prevention
1. **Embedded Credentials**: URLs containing credentials (e.g. `https://admin:secret@evil.com/`) are rejected to prevent phishing deception.
2. **Obfuscated Entities & Control Characters**: Decodes HTML entity encodings (`&#x6a;avascript:`, `&#58;`) and removes control characters (`\0`, `\r`, `\n`, `\t`) prior to scheme inspection.
3. **Whitespace Injection**: Disallows whitespace before or within scheme candidates (e.g. `java\tscript:` or `javascript :`).

---

## 2. Markdown Preview Sanitization

Previews are processed via:
- **Server**: `server/src/services/previewSanitize.ts` strips dangerous tags before persistence.
- **Client**: `src/components/MarkdownContent.tsx` uses `rehype-sanitize` with `src/lib/preview/markdownPolicy.ts`.

### Blocked Elements
- Executable scripts: `<script>`, `<iframe>`, `<object>`, `<embed>`, `<applet>`
- Vector containers: `<svg>`, `<math>`, `<canvas>`
- Interactive and form controls: `<form>`, `<input>`, `<button>`, `<select>`, `<textarea>`, `<dialog>`
- Document-level metadata: `<link>`, `<meta>`, `<base>`, `<title>`
- Event attributes: All `on*` attributes (`onerror`, `onclick`, `onload`, `onmouseover`, etc.)
- Style injection: `style` attributes are stripped to prevent CSS-based exfiltration.

---

## 3. External Link Security Standards

All external links rendered across the client must follow standard security attributes:
1. `target="_blank"`: Opens the external site in a separate browsing context.
2. `rel="noopener noreferrer"`:
   - `noopener`: Prevents the target page from accessing `window.opener` and manipulating the referring application.
   - `noreferrer`: Prevents leaking sensitive URL fragments or referer headers.
3. Clear external indicators (`↗` or `ExternalLink` icon) and accessible screen-reader labels.
