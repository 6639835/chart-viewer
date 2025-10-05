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
});
