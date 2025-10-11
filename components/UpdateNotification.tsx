'use client';

import { useEffect, useState } from 'react';
import { Download, X, RefreshCw, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react';
import type { UpdateInfo, ProgressInfo } from '@/types/electron';

export default function UpdateNotification() {
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    // Detect platform
    setIsMac(navigator.platform.toLowerCase().includes('mac'));
    
    // Only run in Electron environment
    if (typeof window === 'undefined' || !window.electronAPI?.updater) {
      return;
    }

    const updater = window.electronAPI.updater;

    // Set up event listeners
    const cleanupChecking = updater.onChecking(() => {
      console.log('Checking for updates...');
      setChecking(true);
      setError(null);
    });

    const cleanupAvailable = updater.onUpdateAvailable((info: UpdateInfo) => {
      console.log('Update available:', info);
      setChecking(false);
      setUpdateInfo(info);
      setDismissed(false);
    });

    const cleanupNotAvailable = updater.onUpdateNotAvailable((info: UpdateInfo) => {
      console.log('No updates available. Current version:', info.version);
      setChecking(false);
    });

    const cleanupProgress = updater.onDownloadProgress((progressObj: ProgressInfo) => {
      console.log(`Download progress: ${Math.round(progressObj.percent)}%`);
      setProgress(Math.round(progressObj.percent));
    });

    const cleanupDownloaded = updater.onUpdateDownloaded((info: UpdateInfo) => {
      console.log('Update downloaded:', info);
      setDownloading(false);
      setDownloaded(true);
    });

    const cleanupError = updater.onError((errorMsg: string) => {
      console.error('Update error:', errorMsg);
      setChecking(false);
      setDownloading(false);
      setError(errorMsg);
    });

    // Cleanup function
    return () => {
      cleanupChecking();
      cleanupAvailable();
      cleanupNotAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, []);

  const handleDownload = async () => {
    if (!window.electronAPI?.updater) return;
    
    setDownloading(true);
    setError(null);
    const result = await window.electronAPI.updater.downloadUpdate();
    
    if (!result.success) {
      setDownloading(false);
      setError(result.error || result.message || 'Failed to download update');
    }
  };

  const handleInstall = async () => {
    if (!window.electronAPI?.updater) return;
    
    const result = await window.electronAPI.updater.quitAndInstall();
    if (!result.success) {
      setError(result.error || result.message || 'Failed to install update');
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    setError(null);
  };

  const handleOpenRelease = () => {
    const releaseUrl = `https://github.com/6639835/chart-viewer/releases/latest`;
    if (typeof window !== 'undefined') {
      window.open(releaseUrl, '_blank');
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
            ) : downloaded ? (
              <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
            ) : (
              <RefreshCw className={`w-5 h-5 text-blue-500 flex-shrink-0 ${checking ? 'animate-spin' : ''}`} />
            )}
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {error ? '更新错误' : downloaded ? '更新已下载' : '新版本可用'}
            </h3>
          </div>
          <button
            onClick={handleDismiss}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 pb-4">
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400 mb-3">
              {error}
            </p>
          ) : downloaded ? (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                版本 <span className="font-semibold">{updateInfo?.version}</span> 已准备好安装。
                重启应用以完成更新。
              </p>
              <button
                onClick={handleInstall}
                className="w-full bg-green-500 hover:bg-green-600 text-white px-4 py-2.5 rounded-md font-medium transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                立即重启并安装
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                版本 <span className="font-semibold">{updateInfo?.version}</span> 现已可用
                {updateInfo?.releaseNotes && (
                  <span className="block mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                    {updateInfo.releaseNotes}
                  </span>
                )}
              </p>

              {isMac ? (
                /* macOS: 手动下载 */
                <>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mb-3 p-2 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-800">
                    由于 macOS 安全限制，需要手动下载并安装更新
                  </p>
                  <button
                    onClick={handleOpenRelease}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-2.5 rounded-md font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4" />
                    前往下载页面
                  </button>
                </>
              ) : (
                /* Windows/Linux: 自动更新 */
                downloading ? (
                  <div>
                    <div className="relative w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-2 overflow-hidden">
                      <div
                        className="bg-blue-500 h-2.5 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                      下载中... {progress}%
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={handleDownload}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-2.5 rounded-md font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    下载更新
                  </button>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

