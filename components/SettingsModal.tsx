"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, FolderOpen, Loader2, X } from "lucide-react";
import type { AppConfig } from "@/types/config";
import {
  getAppInfo,
  getConfig,
  openExternal,
  saveConfig,
  selectDirectory,
} from "@/lib/tauriClient";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

type ConfigField = "chartsDirectory" | "csvDirectory";

export default function SettingsModal({
  isOpen,
  onClose,
  onSave,
}: SettingsModalProps) {
  const [config, setConfig] = useState<AppConfig>({
    chartsDirectory: "",
    csvDirectory: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    if (!isOpen) return;

    loadConfig();
    loadVersion();
  }, [isOpen]);

  const loadVersion = async () => {
    try {
      const appInfo = await getAppInfo();
      setVersion(appInfo.version);
    } catch (err) {
      console.error("Error loading version:", err);
    }
  };

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      setConfig(await getConfig());
    } catch {
      setError("Error loading configuration");
    } finally {
      setLoading(false);
    }
  };

  const handleBrowseClick = async (field: ConfigField) => {
    try {
      const title =
        field === "chartsDirectory"
          ? "Select Charts Directory"
          : "Select CSV Directory";
      const path = await selectDirectory({
        title,
        defaultPath: config[field] || undefined,
      });

      if (path) {
        setConfig((prev) => ({ ...prev, [field]: path }));
      }
    } catch {
      setError("Error selecting directory");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await saveConfig(config);
      setSuccess(true);
      setTimeout(() => {
        onSave();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenGitHub = () => {
    openExternal("https://github.com/6639835/chart-viewer").catch((err) =>
      console.error("Error opening external URL:", err)
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
            Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close settings"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Charts Directory
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={config.chartsDirectory}
                    onChange={(e) =>
                      setConfig({ ...config, chartsDirectory: e.target.value })
                    }
                    placeholder="charts"
                    className="flex-1 min-w-0 px-3 sm:px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                  <button
                    onClick={() => handleBrowseClick("chartsDirectory")}
                    className="px-3 sm:px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors flex items-center gap-2 flex-shrink-0"
                    title="Browse"
                  >
                    <FolderOpen className="w-5 h-5 text-gray-600 dark:text-gray-300 flex-shrink-0" />
                    <span className="hidden sm:inline text-sm font-medium text-gray-700 dark:text-gray-200">
                      Browse
                    </span>
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Path to the directory containing PDF chart files
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  CSV Directory
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={config.csvDirectory}
                    onChange={(e) =>
                      setConfig({ ...config, csvDirectory: e.target.value })
                    }
                    placeholder="csv"
                    className="flex-1 min-w-0 px-3 sm:px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                  <button
                    onClick={() => handleBrowseClick("csvDirectory")}
                    className="px-3 sm:px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors flex items-center gap-2 flex-shrink-0"
                    title="Browse"
                  >
                    <FolderOpen className="w-5 h-5 text-gray-600 dark:text-gray-300 flex-shrink-0" />
                    <span className="hidden sm:inline text-sm font-medium text-gray-700 dark:text-gray-200">
                      Browse
                    </span>
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Path to the directory containing Charts.csv file
                </p>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3 sm:p-4">
                <div className="flex gap-2 sm:gap-3">
                  <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs sm:text-sm text-blue-900 dark:text-blue-100 min-w-0">
                    <p className="font-medium mb-1">Path Format:</p>
                    <ul className="list-disc list-inside space-y-1 text-blue-800 dark:text-blue-200">
                      <li className="break-words">
                        Use relative paths such as{" "}
                        <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded break-all">
                          charts
                        </code>
                      </li>
                      <li className="break-words">
                        Or use absolute paths selected with the native picker
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  About
                </h3>
                <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                  <p>Chart Viewer - EFB {version ? `v${version}` : "v1.0.0"}</p>
                  <p>© 2025 Justin. All rights reserved.</p>
                  <p>Licensed under MIT License</p>
                  <button
                    onClick={handleOpenGitHub}
                    className="text-blue-600 dark:text-blue-400 hover:underline inline-block cursor-pointer"
                  >
                    GitHub Repository →
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
                  <div className="flex gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                    <p className="text-sm text-red-800 dark:text-red-200">
                      {error}
                    </p>
                  </div>
                </div>
              )}

              {success && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4">
                  <div className="flex gap-3">
                    <Check className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                    <p className="text-sm text-green-800 dark:text-green-200">
                      Configuration saved successfully!
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 p-4 sm:p-6 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 sm:px-6 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 text-sm sm:text-base"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || success}
            className="px-4 sm:px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm sm:text-base"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : success ? (
              <>
                <Check className="w-4 h-4" />
                Saved
              </>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
