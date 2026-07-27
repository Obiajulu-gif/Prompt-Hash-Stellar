# Translation Contributor Guide

This document explains how to add or update translations in **PromptHash**.

---

## How it works

PromptHash uses [react-i18next](https://react.i18next.com/) for internationalisation.  
The i18n configuration lives in [`src/i18n/index.ts`](../src/i18n/index.ts).

- **Supported locales**: English (`en`), Spanish (`es`), French (`fr`), Chinese (`zh`).
- **Default locale**: English (`en`). English strings are the source of truth.
- **Fallback**: If a key is missing in any locale, it automatically falls back to `en`.
- **Storage**: The user's preferred language is persisted in `localStorage` under the key `ph-lang`.

---

## Catalogue structure

All locale files live in `src/i18n/locales/`.

```
src/i18n/locales/
├── en.json   ← source of truth
├── es.json
├── fr.json
└── zh.json
```

Keys are organised by feature namespace:

| Namespace     | Description                            |
|---------------|----------------------------------------|
| `nav`         | Navigation bar labels                  |
| `home`        | Home / hero section copy               |
| `marketplace` | Marketplace page strings               |
| `prompt`      | Individual prompt modal & card strings |
| `receipt`     | Purchase receipt UI                    |
| `sell`        | Sell / list prompt form                |
| `create`      | Create prompt form                     |
| `errors`      | Error messages                         |
| `offline`     | Offline banner                         |
| `language`    | Language switcher label                |
| `format`      | Amount/unit patterns                   |

---

## Adding a new string

1. **Add the key to `en.json` first.**  Every key must exist in English before other locales are updated.

   ```json
   // src/i18n/locales/en.json
   {
     "marketplace": {
       "featured_label": "Featured"
     }
   }
   ```

2. **Add the translated string to every other locale file** (`es.json`, `fr.json`, `zh.json`).  
   If you cannot translate a locale, leave the English value as a placeholder and open a follow-up issue.

3. **Use the key in the component** via `useTranslation`:

   ```tsx
   import { useTranslation } from 'react-i18next';

   function MyComponent() {
     const { t } = useTranslation();
     return <h1>{t('marketplace.featured_label')}</h1>;
   }
   ```

---

## Interpolation (dynamic values)

Use `{{variable}}` placeholders in locale files:

```json
// en.json
{ "marketplace": { "listings_count_other": "{{count}} listings" } }
```

```tsx
t('marketplace.listings_count_other', { count: 42 })
// → "42 listings"
```

---

## Formatting helpers

`src/i18n/formatters.ts` provides locale-aware helpers:

| Helper          | Description                                        |
|-----------------|----------------------------------------------------|
| `formatDate`    | Date → localised short date string                 |
| `formatDateTime`| Date → localised date + time string                |
| `formatNumber`  | Number → locale decimal/thousands separator format |
| `formatXlm`     | Stroops (bigint) → localised XLM amount string     |

```ts
import { formatDate, formatXlm } from '@/i18n/formatters';

formatDate(new Date())           // "27 Jul 2026" (en)
formatXlm(100_000_000n)          // "10 XLM"
```

---

## Adding a new locale

1. Create `src/i18n/locales/<code>.json` using `en.json` as the template.
2. Add the locale to `SUPPORTED_LANGUAGES` in `src/i18n/index.ts`:
   ```ts
   { code: 'de', label: 'Deutsch' },
   ```
3. Import and register it:
   ```ts
   import de from './locales/de.json';
   // inside i18n.init resources:
   de: { translation: de },
   ```
4. Open a PR with the new file and the updated config.

---

## Testing translations

Run the i18n unit tests:

```bash
npx vitest run src/test/i18n
```

The test suite verifies that:
- All core catalogue keys resolve to non-key strings in every locale.
- The English fallback fires for missing keys.
- Formatting helpers produce correct output.
