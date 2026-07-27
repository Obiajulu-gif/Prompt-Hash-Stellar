/**
 * Language switcher for the navbar (#116).
 * Allows users to switch between EN, ES, FR, ZH.
 */
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type SupportedLang } from '@/i18n';

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = i18n.language.slice(0, 2) as SupportedLang;

  return (
    <div className="relative inline-flex items-center gap-1">
      <span className="text-xs text-muted-foreground">{t('language.select')}:</span>
      <select
        value={current}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        aria-label={t('language.select')}
        className="bg-transparent text-sm text-foreground border border-border rounded px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {SUPPORTED_LANGUAGES.map(({ code, label }) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
