"use client";

import { useEffect, useState } from "react";
import { X, RefreshCw, AlertCircle, ExternalLink } from "lucide-react";
import type { UpdateInfo } from "@/types/electron";

export default function UpdateNotification() {
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only run in Electron environment
    if (typeof window === "undefined" || !window.electronAPI?.updater) {
      return;
    }

    const updater = window.electronAPI.updater;

    // Set up event listeners
    const cleanupChecking = updater.onChecking(() => {
      console.log("Checking for updates...");
      setChecking(true);
      setError(null);
    });

    const cleanupAvailable = updater.onUpdateAvailable((info: UpdateInfo) => {
      console.log("Update available:", info);
      setChecking(false);
      setUpdateInfo(info);
      setDismissed(false);
    });

    const cleanupNotAvailable = updater.onUpdateNotAvailable(
      (info: UpdateInfo) => {
        console.log("No updates available. Current version:", info.version);
        setChecking(false);
      }
    );

    const cleanupError = updater.onError((errorMsg: string) => {
      console.error("Update error:", errorMsg);
      setChecking(false);
      setError(errorMsg);
    });

    // Cleanup function
    return () => {
      cleanupChecking();
      cleanupAvailable();
      cleanupNotAvailable();
      cleanupError();
    };
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    setError(null);
  };

  const handleOpenRelease = () => {
    const releaseUrl = `https://github.com/6639835/chart-viewer/releases/latest`;
    if (typeof window !== "undefined") {
      if (window.electronAPI) {
        window.electronAPI.openExternal(releaseUrl);
      } else {
        window.open(releaseUrl, "_blank", "noopener,noreferrer");
      }
    }
  };

  // Don't show anything if dismissed or no update info
  if (dismissed || (!updateInfo && !error)) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <div className="bg-white dark:bg-gray-800 shadow-xl rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-4 pb-3">
          <div className="flex items-center gap-2">
            {error ? (
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            ) : (
              <RefreshCw
                className={`w-5 h-5 text-blue-500 flex-shrink-0 ${checking ? "animate-spin" : ""}`}
              />
            )}
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {error ? "Update Check Failed" : "New Update Available"}
            </h3>
          </div>
          <button
            onClick={handleDismiss}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 pb-4">
          {error ? (
            <>
              <p className="text-sm text-red-600 dark:text-red-400 mb-3">
                {error}
              </p>
              <button
                onClick={handleOpenRelease}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                Check for Updates on GitHub
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                Version{" "}
                <span className="font-semibold">{updateInfo?.version}</span> is
                now available
                {updateInfo?.releaseNotes && (
                  <span className="block mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                    {updateInfo.releaseNotes}
                  </span>
                )}
              </p>
              <button
                onClick={handleOpenRelease}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                Download Update on GitHub
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
