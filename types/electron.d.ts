export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
  releaseName?: string;
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
    onChecking: (callback: () => void) => () => void;
    onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
    onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => () => void;
    onError: (callback: (error: string) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
