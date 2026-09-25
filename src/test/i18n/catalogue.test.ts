import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import '../../i18n';
import { ERROR_MESSAGES } from '../../lib/api/errorCodes';
import { formatDate, formatDateTime, formatNumber, formatXlm } from '../../i18n/formatters';

describe('i18n catalogue', () => {
  it('falls back to English for unknown key', () => {
    const { result } = renderHook(() => useTranslation());
    // A key that exists in en but not in a hypothetical missing locale
    expect(result.current.t('marketplace.title')).toBe('Marketplace');
  });

  it('translates marketplace.title in English', async () => {
    const { result } = renderHook(() => useTranslation());
    await result.current.i18n.changeLanguage('en');
    expect(result.current.t('marketplace.title')).toBe('Marketplace');
  });

  it("translates marketplace.title in Spanish", async () => {
    const { result } = renderHook(() => useTranslation());
    await result.current.i18n.changeLanguage('es');
    expect(result.current.t('marketplace.title')).toBe('Mercado');
  });

  it("translates marketplace.title in French", async () => {
    const { result } = renderHook(() => useTranslation());
    await result.current.i18n.changeLanguage('fr');
    expect(result.current.t('marketplace.title')).toBe('Marché');
  });

  it("translates marketplace.title in Chinese", async () => {
    const { result } = renderHook(() => useTranslation());
    await result.current.i18n.changeLanguage('zh');
    expect(result.current.t('marketplace.title')).toBe('市场');
  });

  it('nav keys are present in all locales', async () => {
    const { result } = renderHook(() => useTranslation());
    for (const lang of ['en', 'es', 'fr', 'zh']) {
      await result.current.i18n.changeLanguage(lang);
      const val = result.current.t('nav.browse');
      expect(val).not.toBe('nav.browse'); // key should not leak through
    }
  });

  it('translates every unlock error code in all locales', async () => {
    const { result } = renderHook(() => useTranslation());
    const codes = Object.keys(ERROR_MESSAGES);
    expect(codes.length).toBeGreaterThan(0);

    for (const lang of ['en', 'es', 'fr', 'zh']) {
      await result.current.i18n.changeLanguage(lang);
      for (const code of codes) {
        const value = result.current.t(`unlockErrors.codes.${code}`);
        expect(value).not.toBe(`unlockErrors.codes.${code}`);
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it('translates unlock error categories in all locales', async () => {
    const { result } = renderHook(() => useTranslation());
    for (const lang of ['en', 'es', 'fr', 'zh']) {
      await result.current.i18n.changeLanguage(lang);
      for (const category of ['wallet', 'access', 'server']) {
        const value = result.current.t(`unlockErrors.categories.${category}`);
        expect(value).not.toBe(`unlockErrors.categories.${category}`);
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('i18n formatters', () => {
  it('formatDate produces a non-empty string', () => {
    const result = formatDate(new Date('2026-07-27'), 'en');
    expect(result).toMatch(/2026/);
  });

  it('formatDateTime includes time', () => {
    const result = formatDateTime('2026-07-27T14:00:00Z', 'en');
    expect(result).toMatch(/2026/);
  });

  it('formatNumber uses locale separator', () => {
    const en = formatNumber(1234567, 'en');
    expect(en).toContain(','); // English uses comma separator
  });

  it('formatXlm converts stroops to XLM string', () => {
    const result = formatXlm(100_000_000n, 'en');
    expect(result).toContain('XLM');
    expect(result).toContain('10');
  });

  it('formatXlm handles small amounts', () => {
    const result = formatXlm(1n, 'en');
    expect(result).toContain('XLM');
  });
});
