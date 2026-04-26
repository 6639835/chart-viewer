"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  getBrowserLocale,
  isLocale,
  LOCALE_LABELS,
  LOCALES,
  translate,
  translateCategory,
  translateChartType,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";
import type { ChartCategory } from "@/types/chart";

const LOCALE_STORAGE_KEY = "chart-viewer-locale";

interface I18nContextValue {
  locale: Locale;
  localeLabels: typeof LOCALE_LABELS;
  locales: typeof LOCALES;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  tc: (category: ChartCategory) => string;
  tChartType: (chartType: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [hasLoadedLocale, setHasLoadedLocale] = useState(false);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
  }, []);

  useEffect(() => {
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    setLocaleState(
      storedLocale && isLocale(storedLocale) ? storedLocale : getBrowserLocale()
    );
    setHasLoadedLocale(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedLocale) {
      return;
    }

    document.documentElement.lang = locale;
    document.documentElement.dir = "ltr";
    document.title = translate(locale, "app.title");
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", translate(locale, "app.description"));
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [hasLoadedLocale, locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      localeLabels: LOCALE_LABELS,
      locales: LOCALES,
      setLocale,
      t: (key, values) => translate(locale, key, values),
      tc: (category) => translateCategory(locale, category),
      tChartType: (chartType) => translateChartType(locale, chartType),
    }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }

  return context;
}
