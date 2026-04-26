"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  // useEffect only runs on the client, so now we can safely show the UI
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        className="w-full p-2 rounded text-gray-900 dark:text-white flex items-center justify-center transition-colors"
        disabled
      >
        <div className="w-5 h-5" />
      </button>
    );
  }

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="w-full p-2 rounded text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-800 flex items-center justify-center transition-colors"
      title={
        theme === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")
      }
      aria-label={t("theme.toggle")}
    >
      {theme === "dark" ? (
        <Sun className="w-5 h-5" />
      ) : (
        <Moon className="w-5 h-5" />
      )}
    </button>
  );
}
