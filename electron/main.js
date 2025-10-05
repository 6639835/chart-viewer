const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let nextServer;
const isDev = process.env.NODE_ENV === 'development';
const port = process.env.PORT || 3000;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'Chart Viewer - EFB',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#ffffff',
    show: false, // Don't show until ready
  });

  // Load the app
  const startUrl = isDev
    ? `http://localhost:${port}`
    : `file://${path.join(__dirname, '../out/index.html')}`;

  mainWindow.loadURL(startUrl);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Start Next.js server in development
async function startNextServer() {
  return new Promise((resolve, reject) => {
    if (!isDev) {
      resolve();
      return;
    }

    console.log('Starting Next.js development server...');
    
    nextServer = spawn('npm', ['run', 'dev'], {
      cwd: path.join(__dirname, '..'),
      shell: true,
      stdio: 'pipe',
    });

    nextServer.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(output);
      
      // Check if server is ready
      if (output.includes('Local:') || output.includes('Ready in')) {
        console.log('Next.js server is ready!');
        // Wait a bit more to ensure server is fully ready
        setTimeout(() => resolve(), 2000);
      }
    });

    nextServer.stderr.on('data', (data) => {
      console.error(`Next.js Error: ${data}`);
    });

    nextServer.on('close', (code) => {
      console.log(`Next.js server exited with code ${code}`);
    });

    nextServer.on('error', (err) => {
      console.error('Failed to start Next.js server:', err);
      reject(err);
    });

    // Timeout if server doesn't start
    setTimeout(() => {
      reject(new Error('Next.js server failed to start within timeout'));
    }, 60000); // 60 second timeout
  });
}

// Handle directory selection
ipcMain.handle('select-directory', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: options?.title || 'Select Directory',
    defaultPath: options?.defaultPath,
    buttonLabel: options?.buttonLabel || 'Select',
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

// Handle file selection
ipcMain.handle('select-file', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: options?.title || 'Select File',
    defaultPath: options?.defaultPath,
    buttonLabel: options?.buttonLabel || 'Select',
    filters: options?.filters || [],
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

// Get app version
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Check if running in Electron
ipcMain.handle('is-electron', () => {
  return true;
});

// App lifecycle
app.whenReady().then(async () => {
  try {
    await startNextServer();
    createWindow();
  } catch (error) {
    console.error('Failed to start application:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (nextServer) {
    nextServer.kill();
  }
  
  // On macOS, keep app running until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Clean up on quit
app.on('before-quit', () => {
  if (nextServer) {
    nextServer.kill();
  }
});
