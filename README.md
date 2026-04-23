# Chart Viewer - EFB

A modern Electronic Flight Bag (EFB) style chart viewer for aviation charts.

## Features

- 📊 **Chart Management**: Browse charts by airport and category
- 🛫 **Multi-Airport Support**: Easy switching between different airports
- 📁 **Smart Categorization**: Charts organized by type (STAR, APP, TAXI, SID, OTHER, 细则)
- 📄 **PDF Viewer**: Built-in PDF viewer with zoom and navigation controls
- ⚙️ **Configurable Directories**: Native desktop picker for chart and CSV directories
- 🎨 **Modern UI**: Clean, professional EFB-style interface
- 🚀 **Fast Performance**: Tauri desktop shell with a static Next.js frontend

## Categories

- **STAR**: Standard Terminal Arrival Routes (标准仪表进场图)
- **APP**: Approach Procedures (仪表进近图)
- **TAXI**: Airport Taxi Charts (机场图\_停机位置图)
- **SID**: Standard Instrument Departures (标准仪表离场图)
- **OTHER**: Other charts (其他, 机场障碍物图等)
- **细则**: Airport Regulations (机场细则)

## Getting Started

### Prerequisites

- Node.js 22+
- npm
- Rust stable toolchain
- Tauri platform prerequisites for your OS

### Installation

```bash
# Install dependencies
npm install

# Generate application icons
npm run generate-icons
```

### Running the Desktop App

```bash
npm run tauri:dev
```

This starts the Next.js dev server and launches the Tauri desktop application.

### Configuring Data Directories

The application uses `charts/` and `csv/` directories by default. To use different directories:

1. Click the **Settings** icon (⚙️) in the sidebar
2. Use the **Browse** button to open the native system directory picker
3. Enter paths (relative to project root or absolute paths):
   - **Charts Directory**: Directory containing PDF chart files
   - **CSV Directory**: Directory containing `Charts.csv` file
4. Click **Save Changes**

Configuration is saved to `config.json` in the Tauri app data directory.

### Building for Production

#### Desktop Application (Local Build)

```bash
# Build for macOS
npm run tauri:build:mac

# Build for Windows
npm run tauri:build:win

# Build for Linux
npm run tauri:build:linux
```

Built applications will be in `src-tauri/target/release/bundle/`.

#### Desktop Application (Automated Build & Release)

The project includes GitHub Actions workflows for automated cross-platform builds:

**Creating a Release:**

```bash
# Interactive release tool
npm run release

# Or manually create a tag
npm version patch  # or minor, major
git push --tags
```

**Build Triggers:**

- **Stable releases**: Push tags like `v1.0.0` → Creates GitHub Release with installers
- **Pre-releases**: Push tags like `v1.0.0-beta.1` → Creates pre-release
- **Manual**: Trigger builds from GitHub Actions tab
- **Pull Requests**: Automatic build verification (no release)

**Supported Platforms:**

- **macOS**: DMG installer + app bundle
- **Windows**: NSIS installer
- **Linux**: AppImage + DEB package

**Download Options:**

- Artifacts available in GitHub Actions (7-14 days)
- Releases published at: `https://github.com/6639835/chart-viewer/releases`

**Updater signing:**

Tauri updater artifacts require `TAURI_SIGNING_PRIVATE_KEY` and, when applicable, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Actions secrets. Generate a key with:

```bash
npx tauri signer generate -w tauri-updater.key
```

### macOS Installation (Unsigned App)

Since the application is not code-signed with an Apple Developer certificate, macOS Gatekeeper may block it from running. After installing the DMG, run this command in Terminal to remove the quarantine attribute:

```bash
xattr -cr "/Applications/Chart Viewer.app"
```

**Alternative methods:**

1. **Right-click method**: Right-click the app → Open → Click "Open" in the security dialog
2. **System Settings**: Go to System Settings → Privacy & Security → Allow the app to run

**Note**: This is only required for the first launch. The command removes the quarantine flag that macOS applies to downloaded applications.

## Project Structure

```
chart-viewer/
├── app/                    # Next.js app directory
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/            # React components
│   ├── Sidebar.tsx        # Airport & category navigation
│   ├── ChartList.tsx      # Chart list display
│   ├── PDFViewer.tsx      # PDF viewer component
│   └── SettingsModal.tsx  # Settings configuration
├── lib/                   # Utility functions
│   ├── chartParser.ts     # CSV parsing logic
│   └── tauriClient.ts     # Tauri command/plugin bridge
├── src-tauri/             # Tauri Rust desktop application
│   ├── src/lib.rs         # Commands, config, chart IO, PDF protocol
│   └── tauri.conf.json    # Tauri app and bundle configuration
├── types/                 # TypeScript types
│   ├── chart.ts           # Chart data types
│   └── config.ts          # Configuration types
├── csv/                   # CSV data files
│   └── Charts.csv         # Chart metadata
├── charts/                # PDF files
│   └── *.pdf              # Chart PDFs
└── out/                   # Static Next.js export (generated)
```

## Data Format

The application reads chart metadata from `csv/Charts.csv` with the following structure:

- `AirportIcao`: Airport ICAO code (e.g., ZBAA)
- `ChartTypeEx_CH`: Chart type in Chinese
- `PAGE_NUMBER`: Page identifier used in PDF filename
- Other metadata fields

### Supported Chart Directory Formats

The application **automatically detects** and supports two directory formats for chart PDFs:

#### Format 1: Flat Structure (All charts in one directory)

```
charts/
  ├── ZBAA-AD2-ZBAA-1-1.pdf
  ├── ZBAA-AD2-ZBAA-1-2.pdf
  ├── ZSSS-AD2-ZSSS-1-1.pdf
  └── 机场细则.pdf
```

#### Format 2: Nested Structure (Organized by airport)

```
charts/
  ├── ZBAA/
  │   ├── ZBAA-AD2-ZBAA-1-1.pdf
  │   ├── ZBAA-AD2-ZBAA-1-2.pdf
  │   └── ZBAA-AD2-ZBAA-1-3.pdf
  ├── ZSSS/
  │   ├── ZSSS-AD2-ZSSS-1-1.pdf
  │   └── ZSSS-AD2-ZSSS-1-2.pdf
  └── 机场细则.pdf
```

**Note**: The system will automatically try the nested format first (checking `{ICAO}/filename`), then fall back to the flat format if the file is not found. No configuration needed!

## Technologies Used

- **Tauri 2**: Native desktop shell and local filesystem bridge
- **Next.js 16**: React framework with App Router static export
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **React-PDF**: PDF rendering
- **PapaParse**: CSV parsing
- **Lucide React**: Icon library

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) file for details

Copyright (c) 2025 Justin

---

Made with ❤️ for aviation enthusiasts
