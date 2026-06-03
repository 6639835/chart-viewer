# Chart Viewer - EFB

Chart Viewer is a desktop Electronic Flight Bag style aviation chart viewer for
local PDF terminal charts. It combines a static Next.js frontend with a Tauri 2
desktop shell so charts, CSV metadata, georeferencing tools, and updater support
can run against local files.

## Features

- Airport and category browser for STAR, APP, TAXI, SID, OTHER, and 细则 charts
- Runway grouping for SID, STAR, and APP charts, plus natural TAXI page sorting
- PDF.js chart viewer with range loading, zoom, rotation, page navigation, theme
  support, and bookmark navigation
- Cesium globe view with OSM/Topo layers, airport centering, and chart overlays
  for georeferenced SID, STAR, and APP pages
- Python sidecar georeferencing pipeline using bundled symbol templates and CSV
  waypoint data
- Optional GDL90 UDP ownship display, defaulting to port 4000
- Configurable chart and CSV directories through the Tauri directory picker
- Internationalized UI, dark/light/system themes, and automatic Tauri updater
  checks for signed GitHub releases

## Prerequisites

- Node.js 22 or newer
- npm
- Rust stable toolchain
- Python 3 with the packages in `scripts/georef-sidecar-requirements.txt`
- Tauri platform prerequisites for your operating system

On Linux, install the WebKitGTK/AppIndicator packages required by Tauri 2. The
GitHub workflows show the current Ubuntu package list.

## Setup

```bash
npm install
python -m pip install -r scripts/georef-sidecar-requirements.txt
```

Regenerate app icons only when `public/icon.svg` changes:

```bash
npm run generate-icons
```

## Development

Run the desktop app:

```bash
npm run tauri:dev
```

This builds the georeferencing sidecar when needed, starts the Next.js dev
server, and launches the Tauri app.

Useful commands:

```bash
npm run lint
npm run test
npm run format:check
npm run build
npm run georef:sidecar
```

`npm run test` runs ESLint and Rust tests for `src-tauri/Cargo.toml`.

## Data Setup

The default data directories are:

- `charts/` for PDF chart files
- `csv/` for chart metadata and optional navigation data

Both directories are intentionally ignored by Git because they usually contain
local or large aviation data. Use Settings in the app to select different
absolute or project-relative directories. The saved config lives in the Tauri
app data directory as `config.json`.

### CSV Formats

Chart Viewer supports two metadata layouts.

Old/global format:

```text
csv/
└── Charts.csv
```

`Charts.csv` should include fields such as `AirportIcao`, `ChartTypeEx_CH`,
`ChartName`, `PAGE_NUMBER`, `IS_SUP`, and `IS_MODIFIED`.

New/per-airport format:

```text
csv/
├── ZBAA/
│   └── Charts.csv
└── ZSSS/
    └── Charts.csv
```

In the per-airport format, the airport ICAO code is inferred from the folder
name. Rows should include `ChartName`, `PAGE_NUMBER`, `ChartTypeEx_CH`,
`IS_SUP`, and `IsModify`.

Optional map/georeference inputs:

- `AD_HP.csv`, `airport.csv`, or `Airport.csv` for airport coordinates
- `DESIGNATED_POINT.csv` and `VOR.csv` for waypoint matching
- `航路点坐标` chart PDFs when the dataset provides waypoint pages

CSV files are decoded as GBK.

### PDF Layouts

PDF paths are generated from the airport ICAO, page number, and chart name. The
resolver first checks airport-nested paths, then flat paths, then subdirectories.

Flat layout:

```text
charts/
├── ZBAA-AD2-ZBAA-1-1.pdf
├── ZBAA-2A.pdf
├── ZBAA-2A(SUP).pdf
└── ZSSS-2A.pdf
```

Airport-nested layout:

```text
charts/
├── ZBAA/
│   ├── ZBAA-AD2-ZBAA-1-1.pdf
│   ├── ZBAA-2A.pdf
│   ├── ZBAA-2A(SUP).pdf
│   └── 机场细则.pdf
└── ZSSS/
    └── ZSSS-2A.pdf
```

Airport detail charts use the chart name as the PDF filename. Regular charts
use `{AirportIcao}-{PAGE_NUMBER}.pdf`; supplements add `(SUP)` before `.pdf`.

## Build

Build the static frontend:

```bash
npm run build
```

Build desktop bundles:

```bash
npm run tauri:build
npm run tauri:build:mac
npm run tauri:build:win
npm run tauri:build:linux
```

Platform-specific scripts produce:

- macOS: DMG and app bundle
- Windows: NSIS installer
- Linux: AppImage and DEB package

Build outputs are written under `src-tauri/target/release/bundle/`.

## Releases and Updates

The repository includes GitHub Actions workflows for stable releases,
pre-releases, and pull request verification.

Release tags:

- Stable: `vX.Y.Z`
- Pre-release: `vX.Y.Z-alpha.N`, `vX.Y.Z-beta.N`, or `vX.Y.Z-rc.N`

Use the interactive release script:

```bash
npm run release
```

The script updates `package.json`, `package-lock.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the chart-viewer entry
in `src-tauri/Cargo.lock`, then creates and pushes the tag.

Updater artifacts require these GitHub Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when the key is password-protected

Generate an updater key with:

```bash
npx tauri signer generate -w tauri-updater.key
```

Keep the private key out of commits. The updater public key is configured in
`src-tauri/tauri.conf.json`, and release workflows generate `latest.json` for
the Tauri updater endpoint.

## macOS Unsigned App

The app is not signed with an Apple Developer certificate. If Gatekeeper blocks
the first launch after installing a downloaded DMG, remove the quarantine flag:

```bash
xattr -cr "/Applications/Chart Viewer.app"
```

You can also right-click the app and choose Open, then confirm the macOS
security dialog.

## Project Structure

```text
chart-viewer/
├── app/                         # Next.js App Router entry points
├── components/                  # React UI components and viewers
├── lib/                         # Chart parsing, Tauri bridge, math, hooks
├── types/                       # Shared TypeScript types
├── scripts/                     # Release, icon, sidecar, and debug scripts
├── src-tauri/                   # Tauri Rust application
│   ├── resources/               # Georeferencing Python resources/templates
│   ├── src/                     # Rust commands, protocol, updater, GDL90
│   └── tauri.conf.json          # Tauri app, bundle, and updater config
├── public/                      # Icons and bundled Cesium static assets
├── .github/                     # CI, release, Dependabot, and templates
├── charts/                      # Local chart PDFs, ignored by Git
└── csv/                         # Local metadata/navigation CSVs, ignored by Git
```

## Technologies

- Tauri 2
- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- PDF.js / pdfjs-dist
- Cesium and Resium
- PapaParse
- Rust
- Python, PyMuPDF, NumPy, PyProj, and PyInstaller

## Contributing

See `CONTRIBUTING.md` for contribution guidelines. For bug reports and feature
requests, use the issue templates in `.github/ISSUE_TEMPLATE`.

## License

MIT License. See `LICENSE` for details.

Copyright (c) 2025 Justin
