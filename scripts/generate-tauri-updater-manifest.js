const { readdir, readFile, writeFile } = require("fs").promises;
const path = require("path");

const repo = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME;
const artifactsDir = process.argv[2] ?? "artifacts";
const outputPath = process.argv[3] ?? path.join(artifactsDir, "latest.json");

if (!repo) {
  throw new Error("GITHUB_REPOSITORY is required");
}

if (!tag) {
  throw new Error("GITHUB_REF_NAME is required");
}

const version = tag.replace(/^v/, "");
const downloadBase = `https://github.com/${repo}/releases/download/${tag}`;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(fullPath) : fullPath;
    })
  );

  return files.flat();
}

function normalizeArch(value) {
  if (value === "amd64" || value === "x64") {
    return "x86_64";
  }

  return value;
}

function archFromText(text) {
  return text.match(
    /(?:^|[_\-.])(aarch64|x86_64|amd64|x64|i686)(?:[_\-.]|$)/i
  )?.[1];
}

function artifactGroup(file) {
  return path.relative(artifactsDir, file).split(path.sep)[0];
}

function inferArch(file, files) {
  const directMatch = archFromText(path.basename(file));
  if (directMatch) {
    return normalizeArch(directMatch);
  }

  const group = artifactGroup(file);
  const groupMatch = files
    .filter((candidate) => artifactGroup(candidate) === group)
    .map((candidate) => archFromText(path.basename(candidate)))
    .find(Boolean);

  if (groupMatch) {
    return normalizeArch(groupMatch);
  }

  throw new Error(`Could not infer updater architecture for ${file}`);
}

function classify(file, files) {
  const name = path.basename(file);

  if (name.endsWith(".app.tar.gz")) {
    const arch = inferArch(file, files);
    return { target: `darwin-${arch}`, installer: "app", priority: 0 };
  }

  if (name.endsWith(".AppImage")) {
    const arch = inferArch(file, files);
    return { target: `linux-${arch}`, installer: "appimage", priority: 1 };
  }

  if (name.endsWith(".deb")) {
    const arch = inferArch(file, files);
    return { target: `linux-${arch}`, installer: "deb", priority: 2 };
  }

  if (name.endsWith(".rpm")) {
    const arch = inferArch(file, files);
    return { target: `linux-${arch}`, installer: "rpm", priority: 3 };
  }

  if (name.endsWith("-setup.exe")) {
    const arch = inferArch(file, files);
    return { target: `windows-${arch}`, installer: "nsis", priority: 1 };
  }

  if (name.endsWith(".msi")) {
    const arch = inferArch(file, files);
    return { target: `windows-${arch}`, installer: "msi", priority: 2 };
  }

  return null;
}

function githubReleaseAssetName(file) {
  return path.basename(file).replace(/\s/g, ".");
}

function downloadUrlFor(file) {
  return `${downloadBase}/${encodeURIComponent(githubReleaseAssetName(file))}`;
}

async function main() {
  const files = (await walk(artifactsDir)).sort();
  const fileSet = new Set(files);
  const updaterPackages = files
    .filter((file) => !file.endsWith(".sig"))
    .map((file) => ({ file, info: classify(file, files) }))
    .filter(({ info }) => info)
    .sort((a, b) => a.info.priority - b.info.priority);

  const platforms = {};

  for (const { file, info } of updaterPackages) {
    const signaturePath = `${file}.sig`;
    if (!fileSet.has(signaturePath)) {
      throw new Error(`Missing updater signature for ${file}`);
    }

    const entry = {
      signature: (await readFile(signaturePath, "utf8")).trim(),
      url: downloadUrlFor(file),
    };

    platforms[`${info.target}-${info.installer}`] = entry;
    platforms[info.target] ??= entry;
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error(`No updater packages found in ${artifactsDir}`);
  }

  const manifest = {
    version,
    pub_date: new Date().toISOString(),
    platforms: Object.fromEntries(Object.entries(platforms).sort()),
  };

  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Generated ${outputPath}`);
  console.log(Object.keys(manifest.platforms).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
