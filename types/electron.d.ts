export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
  releaseName?: string;
}

export interface ProgressInfo {
  percent: number;
  bytesPerSecond: number;
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
  
  updater: {
    checkForUpdates: () => Promise<{ available: boolean; result?: any; error?: string; message?: string }>;
    downloadUpdate: () => Promise<{ success: boolean; error?: string; message?: string }>;
    quitAndInstall: () => Promise<{ success: boolean; error?: string; message?: string }>;
    onChecking: (callback: () => void) => () => void;
    onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
    onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => () => void;
    onDownloadProgress: (callback: (progress: ProgressInfo) => void) => () => void;
    onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void;
    onError: (callback: (error: string) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
