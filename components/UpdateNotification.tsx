"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Download, RefreshCw, Rocket, X } from "lucide-react";
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  openExternal,
  type DownloadProgress,
  type UpdateInfo,
} from "@/lib/tauriClient";

type Phase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export default function UpdateNotification() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPhase("checking");
      setError(null);

      checkForUpdate()
        .then((info) => {
          if (!info) {
            setPhase("idle");
            return;
          }

          setUpdateInfo(info);
          setPhase("available");
          setDismissed(false);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          setPhase("error");
          setDismissed(false);
        });
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
  };

  const handleDownload = async () => {
    setPhase("downloading");
    setProgress(null);

    try {
      const info = await downloadUpdate(setProgress);
      if (info) {
        setUpdateInfo(info);
        setPhase("downloaded");
      } else {
        setPhase("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
      setDismissed(false);
    }
  };

  const handleInstall = async () => {
    try {
      await installUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
      setDismissed(false);
    }
  };

  const handleOpenGitHub = () => {
    openExternal(
      "https://github.com/6639835/chart-viewer/releases/latest"
    ).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    });
  };

  if (dismissed || phase === "idle" || phase === "checking") {
    return null;
  }

  const canDismiss = phase !== "downloading";

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80">
      <div className="bg-white dark:bg-gray-800 shadow-xl rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-start justify-between p-4 pb-3">
          <div className="flex items-center gap-2">
            {phase === "error" ? (
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            ) : phase === "downloading" ? (
              <RefreshCw className="w-5 h-5 text-blue-500 flex-shrink-0 animate-spin" />
            ) : phase === "downloaded" ? (
              <Rocket className="w-5 h-5 text-green-500 flex-shrink-0" />
            ) : (
              <Download className="w-5 h-5 text-blue-500 flex-shrink-0" />
            )}
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
              {phase === "error"
                ? "Update Check Failed"
                : phase === "downloading"
                  ? "Downloading Update…"
                  : phase === "downloaded"
                    ? "Update Ready to Install"
                    : "New Update Available"}
            </h3>
          </div>
          {canDismiss && (
            <button
              onClick={handleDismiss}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors ml-2"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="px-4 pb-4 space-y-3">
          {phase === "error" && (
            <>
              <p className="text-sm text-red-600 dark:text-red-400 break-words">
                {error}
              </p>
              <button
                onClick={handleOpenGitHub}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Check on GitHub
              </button>
            </>
          )}

          {phase === "available" && (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Version{" "}
                <span className="font-semibold text-gray-900 dark:text-white">
                  {updateInfo?.version}
                </span>{" "}
                is available.
                {updateInfo?.releaseNotes && (
                  <span className="block mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                    {updateInfo.releaseNotes}
                  </span>
                )}
              </p>
              <button
                onClick={handleDownload}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download Update
              </button>
            </>
          )}

          {phase === "downloading" && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>{Math.round(progress?.percent ?? 0)}%</span>
                  {progress && (
                    <span>
                      {Math.round(progress.bytesPerSecond / 1024)} KB/s
                    </span>
                  )}
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round(progress?.percent ?? 0)}%` }}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Please wait while the update is downloaded…
              </p>
            </>
          )}

          {phase === "downloaded" && (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Version{" "}
                <span className="font-semibold text-gray-900 dark:text-white">
                  {updateInfo?.version}
                </span>{" "}
                has been downloaded. Restart to apply.
              </p>
              <button
                onClick={handleInstall}
                className="w-full bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Rocket className="w-4 h-4" />
                Restart &amp; Install
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
