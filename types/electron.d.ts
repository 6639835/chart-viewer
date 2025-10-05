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
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
