const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let nextServer;
let serverPort;
const isDev = process.env.NODE_ENV === 'development';

// Get available port for Next.js server
function getPort() {
  if (isDev) {
    return process.env.PORT || 3000;
  }
  // Use a random port in production to avoid conflicts
  return 3000 + Math.floor(Math.random() * 1000);
}

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

  // Load the app - always use HTTP in both dev and production
  const startUrl = `http://localhost:${serverPort}`;
  
  console.log(`Loading application from: ${startUrl}`);
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

// Start Next.js server (both development and production)
async function startNextServer() {
  return new Promise((resolve, reject) => {
    // Assign port before starting server
    serverPort = getPort();
    
    console.log(`Starting Next.js ${isDev ? 'development' : 'production'} server on port ${serverPort}...`);
    
    let resolved = false;
    
    if (isDev) {
      // Development mode: use next dev via npm
      // Set userData path as environment variable for Next.js to use
      const userDataPath = app.getPath('userData');
      
      nextServer = spawn('npm', ['run', 'dev'], {
        cwd: path.join(__dirname, '..'),
        shell: true,
        stdio: 'pipe',
        env: { 
          ...process.env, 
          PORT: serverPort.toString(),
          USER_DATA_PATH: userDataPath
        }
      });
      
      nextServer.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(output);
        
        if (!resolved && (output.includes('Local:') || output.includes('Ready in'))) {
          resolved = true;
          console.log('Next.js server is ready!');
          setTimeout(() => resolve(), 2000);
        }
      });

      nextServer.stderr.on('data', (data) => {
        console.error(`Next.js: ${data}`);
      });

      nextServer.on('error', (err) => {
        console.error('Failed to start Next.js server:', err);
        reject(err);
      });
    } else {
      // Production mode: use Node.js API to start Next.js
      try {
        // Set userData path as environment variable for Next.js to use
        const userDataPath = app.getPath('userData');
        process.env.USER_DATA_PATH = userDataPath;
        console.log(`Config will be saved to: ${path.join(userDataPath, 'config.json')}`);
        
        const next = require('next');
        const nextApp = next({ 
          dev: false, 
          dir: path.join(__dirname, '..'),
          port: serverPort,
        });
        
        nextApp.prepare()
          .then(() => {
            const { createServer } = require('http');
            const handle = nextApp.getRequestHandler();
            
            const server = createServer((req, res) => {
              handle(req, res);
            });
            
            server.listen(serverPort, (err) => {
              if (err) {
                console.error('Failed to start server:', err);
                dialog.showErrorBox(
                  'Server Error',
                  `Failed to start application server:\n${err.message}\n\nThe application will now close.`
                );
                reject(err);
              } else {
                console.log(`Next.js server is ready on http://localhost:${serverPort}`);
                resolved = true;
                // Store server reference for cleanup
                nextServer = { server, kill: () => server.close() };
                setTimeout(() => resolve(), 1000);
              }
            });
          })
          .catch((err) => {
            console.error('Failed to prepare Next.js:', err);
            dialog.showErrorBox(
              'Server Error',
              `Failed to prepare Next.js application:\n${err.message}\n\nThe application will now close.`
            );
            reject(err);
          });
      } catch (err) {
        console.error('Failed to load Next.js:', err);
        dialog.showErrorBox(
          'Server Error',
          `Failed to load Next.js:\n${err.message}\n\nThe application will now close.`
        );
        reject(err);
      }
    }

    // Timeout if server doesn't start
    setTimeout(() => {
      if (!resolved) {
        const errorMsg = 'Next.js server failed to start within 60 seconds';
        console.error(errorMsg);
        dialog.showErrorBox(
          'Startup Timeout',
          `${errorMsg}\n\nPlease check if port ${serverPort} is available.`
        );
        reject(new Error(errorMsg));
      }
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

// Get config file path (in userData directory)
ipcMain.handle('get-config-path', () => {
  const fs = require('fs');
  const userDataPath = app.getPath('userData');
  
  // Ensure userData directory exists
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  
  return path.join(userDataPath, 'config.json');
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
