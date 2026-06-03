#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const sourcePath = join(repoRoot, "src-tauri", "resources", "georef_script.py");
const matcherPath = join(
  repoRoot,
  "src-tauri",
  "resources",
  "pdf_symbol_matcher"
);
const symbolLibraryPath = join(
  repoRoot,
  "src-tauri",
  "resources",
  "symbol_library"
);
const binariesDir = join(repoRoot, "src-tauri", "binaries");
const requirementsPath = join(scriptDir, "georef-sidecar-requirements.txt");
const workRoot = join(binariesDir, ".pyinstaller");
const pyinstallerDataSeparator = process.platform === "win32" ? ";" : ":";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : "";
    throw new Error(`${command} ${args.join(" ")} failed${stderr}`);
  }

  return result.stdout ?? "";
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

function findPython() {
  const configured = process.env.PYTHON;
  const candidates = configured ? [configured] : ["python3", "python"];
  for (const candidate of candidates) {
    if (commandExists(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "Python was not found. Install Python 3 and rerun this command."
  );
}

function hasPythonModule(python, moduleName) {
  const result = spawnSync(
    python,
    [
      "-c",
      `import importlib.util; raise SystemExit(0 if importlib.util.find_spec(${JSON.stringify(moduleName)}) else 1)`,
    ],
    { encoding: "utf8", stdio: "ignore" }
  );
  return !result.error && result.status === 0;
}

function requirePythonModule(python, moduleName, packageName = moduleName) {
  if (hasPythonModule(python, moduleName)) {
    return;
  }

  throw new Error(
    `${packageName} is not installed for ${python}. Run "${python} -m pip install -r scripts/georef-sidecar-requirements.txt".`
  );
}

function getRustHostTriple() {
  const output = run("rustc", ["-Vv"], { capture: true });
  const match = output.match(/^host:\s+(.+)$/m);
  if (!match) {
    throw new Error(
      "Could not determine Rust host target triple from rustc -Vv."
    );
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

function isWindowsTarget(targetTriple) {
  return targetTriple.includes("windows");
}

function newestMtimeMs(inputPath) {
  if (!existsSync(inputPath)) {
    return 0;
  }
  const stats = statSync(inputPath);
  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }
  let newest = stats.mtimeMs;
  for (const entry of readdirSync(inputPath, { withFileTypes: true })) {
    // The PyInstaller work tree and Python caches are build artefacts, not source.
    if (entry.name === "__pycache__" || entry.name === ".pyinstaller") {
      continue;
    }
    newest = Math.max(newest, newestMtimeMs(join(inputPath, entry.name)));
  }
  return newest;
}

function isOutputFresh(outputPath) {
  if (!existsSync(outputPath)) {
    return false;
  }

  const outputTime = statSync(outputPath).mtimeMs;
  for (const inputPath of [
    sourcePath,
    fileURLToPath(import.meta.url),
    requirementsPath,
    matcherPath,
    symbolLibraryPath,
  ]) {
    if (newestMtimeMs(inputPath) > outputTime) {
      return false;
    }
  }
  return true;
}

function main() {
  const targetTriple = getTargetTriple();
  const binaryName = `georef-sidecar-${targetTriple}${isWindowsTarget(targetTriple) ? ".exe" : ""}`;
  const outputPath = join(binariesDir, binaryName);

  mkdirSync(binariesDir, { recursive: true });

  if (process.env.GEOREF_SIDECAR_DRY_RUN === "1") {
    console.log(outputPath);
    return;
  }

  if (isOutputFresh(outputPath)) {
    console.log(`Georef sidecar is up to date: ${outputPath}`);
    return;
  }

  const python = findPython();
  requirePythonModule(python, "fitz", "PyMuPDF");
  requirePythonModule(python, "numpy");
  requirePythonModule(python, "pyproj");
  requirePythonModule(python, "PyInstaller");

  const pyinstallerArgs = [
    "-m",
    "PyInstaller",
    "--clean",
    "--noconfirm",
    "--onefile",
    "--name",
    binaryName,
    "--distpath",
    binariesDir,
    "--workpath",
    join(workRoot, targetTriple, "build"),
    "--specpath",
    join(workRoot, targetTriple, "spec"),
    "--collect-all",
    "fitz",
    "--collect-all",
    "numpy",
    "--collect-all",
    "pyproj",
    "--add-data",
    `${matcherPath}${pyinstallerDataSeparator}pdf_symbol_matcher`,
    "--add-data",
    `${symbolLibraryPath}${pyinstallerDataSeparator}symbol_library`,
  ];

  if (hasPythonModule(python, "pymupdf")) {
    pyinstallerArgs.push("--collect-all", "pymupdf");
  }

  pyinstallerArgs.push(sourcePath);

  run(python, pyinstallerArgs);

  if (!isWindowsTarget(targetTriple)) {
    chmodSync(outputPath, 0o755);
  }

  console.log(`Built georef sidecar: ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
