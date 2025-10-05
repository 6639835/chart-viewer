# Chart Viewer - EFB

A modern Electronic Flight Bag (EFB) style chart viewer for aviation charts.

## Features

- 📊 **Chart Management**: Browse charts by airport and category
- 🛫 **Multi-Airport Support**: Easy switching between different airports
- 📁 **Smart Categorization**: Charts organized by type (STAR, APP, TAXI, SID, OTHER, 细则)
- 📄 **PDF Viewer**: Built-in PDF viewer with zoom and navigation controls
- ⚙️ **Configurable Directories**: Web-based interface to select charts and CSV directories
- 🎨 **Modern UI**: Clean, professional EFB-style interface
- 🚀 **Fast Performance**: Next.js powered for optimal speed

## Categories

- **STAR**: Standard Terminal Arrival Routes (标准仪表进场图)
- **APP**: Approach Procedures (仪表进近图)
- **TAXI**: Airport Taxi Charts (机场图_停机位置图)
- **SID**: Standard Instrument Departures (标准仪表离场图)
- **OTHER**: Other charts (其他, 机场障碍物图等)
- **细则**: Airport Regulations (机场细则)

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Generate application icons
npm run generate-icons
```

### Running the Development Server

#### Web Mode (Browser)
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

#### Desktop Mode (Electron)
```bash
npm run electron:dev
```

This will start the Next.js dev server and launch the desktop application with native system dialogs for directory selection.

### Configuring Data Directories

The application uses `charts/` and `csv/` directories by default. To use different directories:

1. Click the **Settings** icon (⚙️) in the sidebar
2. Use the **Browse** button to:
   - **Desktop Mode**: Opens native system file picker (Finder on macOS)
   - **Web Mode**: Use web-based directory browser
3. Enter paths (relative to project root or absolute paths):
   - **Charts Directory**: Directory containing PDF chart files
   - **CSV Directory**: Directory containing `Charts.csv` file
4. Click **Save Changes**

Configuration is saved to `config.json` in the project root.

### Building for Production

#### Web Version
```bash
npm run build
npm start
```

#### Desktop Application (Local Build)
```bash
# Build for macOS
npm run electron:build:mac

# Build for Windows
npm run electron:build:win

# Build for Linux
npm run electron:build:linux
```

Built applications will be in the `dist/` directory.

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
- **macOS**: DMG installer + ZIP archive
- **Windows**: NSIS installer + Portable executable
- **Linux**: AppImage + DEB package

**Download Options:**
- Artifacts available in GitHub Actions (7-14 days)
- Releases published at: `https://github.com/YOUR_USERNAME/chart-viewer/releases`

For detailed release documentation, see [`.github/workflows/README.md`](.github/workflows/README.md).

## Project Structure

```
chart-viewer/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   ├── charts/        # Chart data API
│   │   ├── pdf/           # PDF serving API
│   │   ├── config/        # Configuration API
│   │   └── browse/        # Directory browsing API
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/            # React components
│   ├── Sidebar.tsx        # Airport & category navigation
│   ├── ChartList.tsx      # Chart list display
│   ├── PDFViewer.tsx      # PDF viewer component
│   └── SettingsModal.tsx  # Settings configuration
├── electron/              # Electron application
│   ├── main.js           # Main process (app lifecycle)
│   └── preload.js        # Preload script (IPC bridge)
├── lib/                   # Utility functions
│   ├── chartParser.ts     # CSV parsing logic
│   └── configManager.ts   # Configuration management
├── types/                 # TypeScript types
│   ├── chart.ts           # Chart data types
│   ├── config.ts          # Configuration types
│   └── electron.d.ts      # Electron API types
├── csv/                   # CSV data files
│   └── Charts.csv         # Chart metadata
├── charts/                # PDF files
│   └── *.pdf              # Chart PDFs
└── config.json            # User configuration (generated)
```

## Data Format

The application reads chart metadata from `csv/Charts.csv` with the following structure:

- `AirportIcao`: Airport ICAO code (e.g., ZBAA)
- `ChartTypeEx_CH`: Chart type in Chinese
- `PAGE_NUMBER`: Page identifier used in PDF filename
- Other metadata fields

PDF files are named as: `{AirportIcao}-{PAGE_NUMBER}.pdf`

## Technologies Used

- **Next.js 14**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **React-PDF**: PDF rendering
- **PapaParse**: CSV parsing
- **Lucide React**: Icon library

## License

Private Project

