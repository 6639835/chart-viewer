const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Directory selection
  selectDirectory: (options) => ipcRenderer.invoke('select-directory', options),
  
  // File selection
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Check if running in Electron
  isElectron: () => ipcRenderer.invoke('is-electron'),
  
  // Auto-updater methods
  updater: {
    // Check for updates
    checkForUpdates: () => ipcRenderer.invoke('updater-check-for-updates'),
    
    // Download update
    downloadUpdate: () => ipcRenderer.invoke('updater-download-update'),
    
    // Quit and install update
    quitAndInstall: () => ipcRenderer.invoke('updater-quit-and-install'),
    
    // Event listeners (one-way from main to renderer)
    onChecking: (callback) => {
      ipcRenderer.on('updater-checking', () => callback());
      return () => ipcRenderer.removeAllListeners('updater-checking');
    },
    
    onUpdateAvailable: (callback) => {
      ipcRenderer.on('updater-update-available', (_, info) => callback(info));
      return () => ipcRenderer.removeAllListeners('updater-update-available');
    },
    
    onUpdateNotAvailable: (callback) => {
      ipcRenderer.on('updater-update-not-available', (_, info) => callback(info));
      return () => ipcRenderer.removeAllListeners('updater-update-not-available');
    },
    
    onDownloadProgress: (callback) => {
      ipcRenderer.on('updater-download-progress', (_, progress) => callback(progress));
      return () => ipcRenderer.removeAllListeners('updater-download-progress');
    },
    
    onUpdateDownloaded: (callback) => {
      ipcRenderer.on('updater-update-downloaded', (_, info) => callback(info));
      return () => ipcRenderer.removeAllListeners('updater-update-downloaded');
    },
    
    onError: (callback) => {
      ipcRenderer.on('updater-error', (_, error) => callback(error));
      return () => ipcRenderer.removeAllListeners('updater-error');
    }
  }
});
