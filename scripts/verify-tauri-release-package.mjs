#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const sidecarOnly = process.argv.includes("--sidecar-only");
const releaseDir = join(repoRoot, "src-tauri", "target", "release");
const bundleDir = join(releaseDir, "bundle");
const sidecarBaseName = "georef-sidecar";
const sidecarFileName =
  process.platform === "win32" ? `${sidecarBaseName}.exe` : sidecarBaseName;

function fail(message) {
  throw new Error(message);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }

  return result.stdout;
}

function getRustHostTriple() {
  const output = run("rustc", ["-Vv"]);
  const match = output.match(/^host:\s+(.+)$/m);
  if (!match) {
    fail("Could not determine Rust host target triple from rustc -Vv.");
  }
  return match[1].trim();
}

function getTargetTriple() {
  return (
    process.env.TAURI_TARGET_TRIPLE ||
    process.env.CARGO_BUILD_TARGET ||
    process.env.TARGET_TRIPLE ||
    getRustHostTriple()
  );
}

function isExecutable(filePath) {
  if (process.platform === "win32") {
    return true;
  }
  return (statSync(filePath).mode & 0o111) !== 0;
}

function requireFile(filePath, description) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    fail(`Missing ${description}: ${filePath}`);
  }
  return filePath;
}

function requireExecutable(filePath, description) {
  requireFile(filePath, description);
  if (!isExecutable(filePath)) {
    fail(`${description} is not executable: ${filePath}`);
  }
}

function walkFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = join(root, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function hasFileEnding(files, suffix) {
  return files.some((file) => file.endsWith(suffix));
}

function requirePackage(files, suffix, description) {
  if (!hasFileEnding(files, suffix)) {
    fail(`Missing ${description} package matching *${suffix}`);
  }
}

function requireSignatureFor(files, predicate, description) {
  const packages = files.filter(predicate);
  if (packages.length === 0) {
    fail(`Missing ${description} updater package`);
  }

  for (const packagePath of packages) {
    requireFile(`${packagePath}.sig`, `${description} updater signature`);
  }
}

function verifySidecarBuild() {
  const targetTriple = getTargetTriple();
  const builtSidecar = join(
    repoRoot,
    "src-tauri",
    "binaries",
    `${sidecarBaseName}-${targetTriple}${process.platform === "win32" ? ".exe" : ""}`
  );

  requireExecutable(builtSidecar, "target-specific georeferencing sidecar");
  console.log(`Verified sidecar build: ${relative(repoRoot, builtSidecar)}`);
}

function verifyTauriBuild() {
  const stagedSidecar = join(releaseDir, sidecarFileName);
  requireExecutable(stagedSidecar, "Tauri staged georeferencing sidecar");

  const files = walkFiles(bundleDir);
  if (files.length === 0) {
    fail(`No release bundle files found under ${bundleDir}`);
  }

  if (process.platform === "darwin") {
    requirePackage(files, ".dmg", "macOS DMG");
    requireSignatureFor(
      files,
      (file) => file.endsWith(".app.tar.gz"),
      "macOS app archive"
    );

    const bundledSidecars = files.filter((file) =>
      file.endsWith(join("Contents", "MacOS", sidecarFileName))
    );
    if (bundledSidecars.length === 0) {
      fail("Missing georeferencing sidecar inside the macOS .app bundle");
    }
    for (const bundledSidecar of bundledSidecars) {
      requireExecutable(bundledSidecar, "macOS bundled georeferencing sidecar");
    }
  } else if (process.platform === "linux") {
    requirePackage(files, ".AppImage", "Linux AppImage");
    requirePackage(files, ".deb", "Linux Debian");
    requireSignatureFor(
      files,
      (file) => file.endsWith(".AppImage") || file.endsWith(".deb"),
      "Linux"
    );
  } else if (process.platform === "win32") {
    requirePackage(files, "setup.exe", "Windows NSIS");
    requireSignatureFor(
      files,
      (file) => file.endsWith("setup.exe") || file.endsWith(".msi"),
      "Windows"
    );
  } else {
    fail(`Unsupported release platform: ${process.platform}`);
  }

  console.log(
    `Verified release packages under ${relative(repoRoot, bundleDir)}`
  );
}

try {
  verifySidecarBuild();
  if (!sidecarOnly) {
    verifyTauriBuild();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
