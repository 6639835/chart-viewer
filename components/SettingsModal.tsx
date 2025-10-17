"use client";

import { useState, useEffect, useRef } from "react";
import {
  X,
  FolderOpen,
  Loader2,
  Check,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { AppConfig } from "@/types/config";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

interface DirectoryInfo {
  currentPath: string;
  parentPath: string | null;
  directories: { name: string; path: string }[];
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
  const [isElectron, setIsElectron] = useState(false);
  const [version, setVersion] = useState<string>("");

  // Directory browser state
  const [browsing, setBrowsing] = useState<ConfigField | null>(null);
  const [directoryInfo, setDirectoryInfo] = useState<DirectoryInfo | null>(
    null
  );
  const [browseLoading, setBrowseLoading] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const directoryListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      checkElectron();
      loadVersion();
    }
  }, [isOpen]);

  const checkElectron = async () => {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result = await window.electronAPI.isElectron();
      setIsElectron(result);
    }
  };

  const loadVersion = async () => {
    try {
      const response = await fetch("/api/version");
      const data = await response.json();
      if (data.success) {
        setVersion(data.version);
      }
    } catch (err) {
      console.error("Error loading version:", err);
    }
  };

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/config");
      const data = await response.json();
      if (data.success) {
        setConfig(data.data);
      } else {
        setError("Failed to load configuration");
      }
    } catch (err) {
      setError("Error loading configuration");
    } finally {
      setLoading(false);
    }
  };

  const browseDirectory = async (path?: string) => {
    setBrowseLoading(true);
    try {
      const response = await fetch("/api/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dirPath: path }),
      });
      const data = await response.json();
      if (data.success) {
        setDirectoryInfo(data.data);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError("Error browsing directory");
    } finally {
      setBrowseLoading(false);
    }
  };

  const handleBrowseClick = async (field: ConfigField) => {
    // If running in Electron, use native dialog
    if (isElectron && window.electronAPI) {
      try {
        const title =
          field === "chartsDirectory"
            ? "Select Charts Directory"
            : "Select CSV Directory";

        const path = await window.electronAPI.selectDirectory({
          title,
          defaultPath: config[field] || undefined,
        });

        if (path) {
          setConfig((prev) => ({ ...prev, [field]: path }));
        }
      } catch (err) {
        setError("Error selecting directory");
      }
      return;
    }

    // Otherwise, use web-based directory browser
    setBrowsing(field);
    setDirectoryInfo(null);
    browseDirectory();
  };

  const handleDirectorySelect = (path: string) => {
    if (browsing) {
      setConfig((prev) => ({ ...prev, [browsing]: path }));
      setBrowsing(null);
      setDirectoryInfo(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          onSave();
          onClose();
        }, 1500);
      } else {
        setError(
          data.error + (data.details ? ": " + data.details.join(", ") : "")
        );
      }
    } catch (err) {
      setError("Error saving configuration");
    } finally {
      setSaving(false);
    }
  };

  // Handle scroll for directory list
  useEffect(() => {
    const scrollContainer = directoryListRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      setIsScrolling(true);

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 1000);
    };

    scrollContainer.addEventListener("scroll", handleScroll);

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [browsing]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          ) : browsing ? (
            // Directory Browser
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Select {browsing === "chartsDirectory" ? "Charts" : "CSV"}{" "}
                  Directory
                </h3>
                <button
                  onClick={() => {
                    setBrowsing(null);
                    setDirectoryInfo(null);
                  }}
                  className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  Cancel
                </button>
              </div>

              {directoryInfo && (
                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 mb-4">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Current Path:
                  </div>
                  <div className="text-sm font-mono text-gray-900 dark:text-white break-all">
                    {directoryInfo.currentPath}
                  </div>
                </div>
              )}

              {browseLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                </div>
              ) : directoryInfo ? (
                <div className="space-y-2">
                  {/* Parent directory */}
                  {directoryInfo.parentPath && (
                    <button
                      onClick={() => browseDirectory(directoryInfo.parentPath!)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                    >
                      <ChevronLeft className="w-5 h-5 text-gray-400" />
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                        ..
                      </span>
                    </button>
                  )}

                  {/* Current directory - select option */}
                  <button
                    onClick={() =>
                      handleDirectorySelect(directoryInfo.currentPath)
                    }
                    className="w-full flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors text-left border-2 border-blue-200 dark:border-blue-700"
                  >
                    <Check className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      Use this directory
                    </span>
                  </button>

                  {/* Subdirectories */}
                  <div
                    ref={directoryListRef}
                    className={`space-y-1 max-h-96 overflow-y-auto auto-hide-scrollbar ${isScrolling ? "scrolling" : ""}`}
                  >
                    {directoryInfo.directories.map((dir) => (
                      <button
                        key={dir.path}
                        onClick={() => browseDirectory(dir.path)}
                        className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                      >
                        <FolderOpen className="w-5 h-5 text-blue-500" />
                        <span className="text-sm text-gray-900 dark:text-white flex-1">
                          {dir.name}
                        </span>
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      </button>
                    ))}
                  </div>

                  {directoryInfo.directories.length === 0 && (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
                      No subdirectories found
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            // Configuration Form
            <div className="space-y-6">
              {/* Charts Directory */}
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
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    onClick={() => handleBrowseClick("chartsDirectory")}
                    className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <FolderOpen className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      Browse
                    </span>
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Path to the directory containing PDF chart files
                </p>
              </div>

              {/* CSV Directory */}
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
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    onClick={() => handleBrowseClick("csvDirectory")}
                    className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <FolderOpen className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      Browse
                    </span>
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Path to the directory containing Charts.csv file
                </p>
              </div>

              {/* Info Box */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-900 dark:text-blue-100">
                    <p className="font-medium mb-1">Path Format:</p>
                    <ul className="list-disc list-inside space-y-1 text-blue-800 dark:text-blue-200">
                      <li>
                        Use relative paths (e.g.,{" "}
                        <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">
                          charts
                        </code>
                        ) or
                      </li>
                      <li>
                        Use absolute paths (e.g.,{" "}
                        <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">
                          /Users/name/data/charts
                        </code>
                        )
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* About Section */}
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  About
                </h3>
                <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                  <p>Chart Viewer - EFB {version ? `v${version}` : "v1.0.0"}</p>
                  <p>© 2025 Justin. All rights reserved.</p>
                  <p>Licensed under MIT License</p>
                  <button
                    onClick={() => {
                      const url = "https://github.com/6639835/chart-viewer";
                      if (typeof window !== "undefined" && window.electronAPI) {
                        window.electronAPI.openExternal(url);
                      } else {
                        window.open(url, "_blank", "noopener,noreferrer");
                      }
                    }}
                    className="text-blue-600 dark:text-blue-400 hover:underline inline-block cursor-pointer"
                  >
                    GitHub Repository →
                  </button>
                </div>
              </div>

              {/* Error Message */}
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

              {/* Success Message */}
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

        {/* Footer */}
        {!browsing && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-6 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || success}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
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
        )}
      </div>
    </div>
  );
}
