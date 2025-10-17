const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow;
let nextServer;
let serverPort;
const isDev = process.env.NODE_ENV === "development";

// Get available port for Next.js server
function getPort() {
  if (isDev) {
    return process.env.PORT || 3000;
  }
  // Use a random port in production to avoid conflicts
  return 3000 + Math.floor(Math.random() * 1000);
}

// Setup auto updater
function setupAutoUpdater() {
  // Only enable auto-update in production
  if (isDev) {
    console.log("Auto-updater disabled in development mode");
    return;
  }

  // Configure update feed URL (using GitHub)
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "6639835",
    repo: "chart-viewer",
  });

  // Don't automatically download updates - users will download manually from GitHub
  autoUpdater.autoDownload = false;

  // Add detailed logging for debugging
  console.log("Auto-updater configured:", {
    provider: "github",
    owner: "6639835",
    repo: "chart-viewer",
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  });

  // Update event listeners
  autoUpdater.on("checking-for-update", () => {
    console.log("Checking for update...");
    if (mainWindow) {
      mainWindow.webContents.send("updater-checking");
    }
  });

  autoUpdater.on("update-available", (info) => {
    console.log("Update available:", info.version);
    if (mainWindow) {
      mainWindow.webContents.send("updater-update-available", info);
    }
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log("Update not available. Current version:", info.version);
    if (mainWindow) {
      mainWindow.webContents.send("updater-update-not-available", info);
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("Auto-updater error:", {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });

    let errorMessage = err.message || String(err);

    if (mainWindow) {
      mainWindow.webContents.send("updater-error", errorMessage);
    }
  });

  // Check for updates 5 seconds after app starts
  setTimeout(() => {
    console.log("Checking for updates...");
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("Failed to check for updates:", err);
    });
  }, 5000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: "Chart Viewer - EFB",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    backgroundColor: "#ffffff",
    show: false, // Don't show until ready
  });

  // Load the app - always use HTTP in both dev and production
  const startUrl = `http://localhost:${serverPort}`;

  console.log(`Loading application from: ${startUrl}`);
  mainWindow.loadURL(startUrl);

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Check if port is in use
function checkPort(port) {
  return new Promise((resolve) => {
    const net = require("net");
    const server = net.createServer();
    server.once("error", () => {
      resolve(true); // Port is in use
    });
    server.once("listening", () => {
      server.close();
      resolve(false); // Port is free
    });
    server.listen(port);
  });
}

// Start Next.js server (both development and production)
async function startNextServer() {
  return new Promise(async (resolve, reject) => {
    // Assign port before starting server
    serverPort = getPort();

    // In development mode, check if server is already running
    if (isDev) {
      const portInUse = await checkPort(serverPort);
      if (portInUse) {
        console.log(
          `Next.js development server already running on port ${serverPort}`
        );
        // Server is already running (started by electron-dev.js), just resolve
        return resolve();
      }
    }

    console.log(
      `Starting Next.js ${isDev ? "development" : "production"} server on port ${serverPort}...`
    );

    let resolved = false;

    if (isDev) {
      // Development mode: use next dev via npm
      // Set userData path as environment variable for Next.js to use
      const userDataPath = app.getPath("userData");

      nextServer = spawn("npm", ["run", "dev"], {
        cwd: path.join(__dirname, ".."),
        shell: true,
        stdio: "pipe",
        env: {
          ...process.env,
          PORT: serverPort.toString(),
          USER_DATA_PATH: userDataPath,
        },
      });

      nextServer.stdout.on("data", (data) => {
        const output = data.toString();
        console.log(output);

        if (
          !resolved &&
          (output.includes("Local:") || output.includes("Ready in"))
        ) {
          resolved = true;
          console.log("Next.js server is ready!");
          setTimeout(() => resolve(), 2000);
        }
      });

      nextServer.stderr.on("data", (data) => {
        console.error(`Next.js: ${data}`);
      });

      nextServer.on("error", (err) => {
        console.error("Failed to start Next.js server:", err);
        reject(err);
      });
    } else {
      // Production mode: use Node.js API to start Next.js
      try {
        // Set userData path as environment variable for Next.js to use
        const userDataPath = app.getPath("userData");
        process.env.USER_DATA_PATH = userDataPath;
        console.log(
          `Config will be saved to: ${path.join(userDataPath, "config.json")}`
        );

        const next = require("next");
        const nextApp = next({
          dev: false,
          dir: path.join(__dirname, ".."),
          port: serverPort,
        });

        nextApp
          .prepare()
          .then(() => {
            const { createServer } = require("http");
            const handle = nextApp.getRequestHandler();

            const server = createServer((req, res) => {
              handle(req, res);
            });

            server.listen(serverPort, (err) => {
              if (err) {
                console.error("Failed to start server:", err);
                dialog.showErrorBox(
                  "Server Error",
                  `Failed to start application server:\n${err.message}\n\nThe application will now close.`
                );
                reject(err);
              } else {
                console.log(
                  `Next.js server is ready on http://localhost:${serverPort}`
                );
                resolved = true;
                // Store server reference for cleanup
                nextServer = { server, kill: () => server.close() };
                setTimeout(() => resolve(), 1000);
              }
            });
          })
          .catch((err) => {
            console.error("Failed to prepare Next.js:", err);
            dialog.showErrorBox(
              "Server Error",
              `Failed to prepare Next.js application:\n${err.message}\n\nThe application will now close.`
            );
            reject(err);
          });
      } catch (err) {
        console.error("Failed to load Next.js:", err);
        dialog.showErrorBox(
          "Server Error",
          `Failed to load Next.js:\n${err.message}\n\nThe application will now close.`
        );
        reject(err);
      }
    }

    // Timeout if server doesn't start
    setTimeout(() => {
      if (!resolved) {
        const errorMsg = "Next.js server failed to start within 60 seconds";
        console.error(errorMsg);
        dialog.showErrorBox(
          "Startup Timeout",
          `${errorMsg}\n\nPlease check if port ${serverPort} is available.`
        );
        reject(new Error(errorMsg));
      }
    }, 60000); // 60 second timeout
  });
}

// Handle directory selection
ipcMain.handle("select-directory", async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: options?.title || "Select Directory",
    defaultPath: options?.defaultPath,
    buttonLabel: options?.buttonLabel || "Select",
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

// Handle file selection
ipcMain.handle("select-file", async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    title: options?.title || "Select File",
    defaultPath: options?.defaultPath,
    buttonLabel: options?.buttonLabel || "Select",
    filters: options?.filters || [],
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

// Get app version
ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

// Check if running in Electron
ipcMain.handle("is-electron", () => {
  return true;
});

// Open URL in default browser
ipcMain.handle("open-external", async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error("Error opening external URL:", error);
    return { success: false, error: error.message };
  }
});

// Get config file path (in userData directory)
ipcMain.handle("get-config-path", () => {
  const fs = require("fs");
  const userDataPath = app.getPath("userData");

  // Ensure userData directory exists
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  return path.join(userDataPath, "config.json");
});

// Auto-updater IPC handlers
ipcMain.handle("updater-check-for-updates", async () => {
  if (isDev) {
    return {
      available: false,
      message: "Updates disabled in development mode",
    };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { available: true, result };
  } catch (error) {
    console.error("Error checking for updates:", error);
    return { available: false, error: error.message };
  }
});

// App lifecycle
app.whenReady().then(async () => {
  try {
    await startNextServer();
    createWindow();
    setupAutoUpdater();
  } catch (error) {
    console.error("Failed to start application:", error);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (nextServer) {
    nextServer.kill();
  }

  // On macOS, keep app running until explicitly quit
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Clean up on quit
app.on("before-quit", () => {
  if (nextServer) {
    nextServer.kill();
  }
});
