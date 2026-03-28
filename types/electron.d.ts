export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
  releaseName?: string;
}

export interface DownloadProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export interface ElectronAPI {
  selectDirectory: (options?: {
    title?: string;
    defaultPath?: string;
    buttonLabel?: string;
  }) => Promise<string | null>;

  selectFile: (options?: {
    title?: string;
    defaultPath?: string;
    buttonLabel?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<string | null>;

  getAppVersion: () => Promise<string>;

  isElectron: () => Promise<boolean>;

  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;

  updater: {
    checkForUpdates: () => Promise<{
      available: boolean;
      result?: unknown;
      error?: string;
      message?: string;
    }>;
    downloadUpdate: () => Promise<void>;
    installUpdate: () => Promise<void>;
    onChecking: (callback: () => void) => () => void;
    onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
    onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => () => void;
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
    onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void;
    onError: (callback: (error: string) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
