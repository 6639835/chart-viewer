#!/usr/bin/env node

/**
 * Electron development launcher
 * This script starts the Next.js dev server and then launches Electron
 */

const { spawn } = require("child_process");
const net = require("net");

const PORT = 3000;

// Check if port is in use
function checkPort(port) {
  return new Promise((resolve) => {
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

// Wait for server to be ready
function waitForServer(port, maxAttempts = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const check = () => {
      attempts++;
      const client = net.connect({ port }, () => {
        client.end();
        resolve();
      });

      client.on("error", () => {
        if (attempts >= maxAttempts) {
          reject(new Error("Server failed to start"));
        } else {
          setTimeout(check, 1000);
        }
      });
    };

    check();
  });
}

async function main() {
  console.log("🚀 Starting Chart Viewer in Electron mode...\n");

  // Check if dev server is already running
  const portInUse = await checkPort(PORT);

  let nextProcess;

  if (!portInUse) {
    console.log("📦 Starting Next.js development server...");
    nextProcess = spawn("npm", ["run", "dev"], {
      stdio: "inherit",
      shell: true,
    });

    // Wait for server to be ready
    try {
      await waitForServer(PORT);
      console.log("✅ Next.js server is ready!\n");
    } catch (error) {
      console.error("❌ Failed to start Next.js server");
      process.exit(1);
    }
  } else {
    console.log("✅ Next.js server already running\n");
  }

  // Start Electron
  console.log("🖥️  Launching Electron...\n");
  const electronProcess = spawn("electron", ["."], {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: "development",
    },
  });

  // Handle cleanup
  const cleanup = () => {
    console.log("\n🛑 Shutting down...");
    if (nextProcess) {
      nextProcess.kill();
    }
    electronProcess.kill();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  electronProcess.on("close", () => {
    console.log("👋 Electron closed");
    if (nextProcess && !portInUse) {
      nextProcess.kill();
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
