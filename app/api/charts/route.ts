import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import iconv from "iconv-lite";
import {
  groupChartsByAirport,
  parseCSV,
  parsePerAirportCSV,
} from "@/lib/chartParser";
import { getConfig } from "@/lib/configManager";
import type { ChartData } from "@/types/chart";

type CsvFormat = "old" | "new";

function resolveConfigDir(dirPath: string) {
  return path.isAbsolute(dirPath) ? dirPath : path.join(process.cwd(), dirPath);
}

async function detectFormat(csvDir: string): Promise<CsvFormat> {
  try {
    const csvPath = path.join(csvDir, "Charts.csv");
    const buffer = await fs.readFile(csvPath);
    const csvContent = iconv.decode(buffer, "GBK");

    // Check if this is the new format (minimal Charts.csv with just header)
    const lines = csvContent.trim().split("\n");

    // If Charts.csv has only 1 line (header) or very few lines, it's likely the new format
    if (lines.length <= 1) {
      return "new";
    }

    // Check if the first data line has AirportIcao column
    const header = lines[0].toLowerCase();
    if (header.includes("airporticao")) {
      return "old";
    }

    return "new";
  } catch {
    // If Charts.csv doesn't exist, assume new format
    return "new";
  }
}

async function loadOldFormat(csvDir: string): Promise<ChartData[]> {
  const csvPath = path.join(csvDir, "Charts.csv");
  const buffer = await fs.readFile(csvPath);
  const csvContent = iconv.decode(buffer, "GBK");
  return parseCSV(csvContent);
}

async function loadNewFormat(csvDir: string): Promise<ChartData[]> {
  const allCharts: ChartData[] = [];

  // Read all directories in csvDir
  const entries = await fs.readdir(csvDir, { withFileTypes: true });

  // Filter for directories (airport folders)
  const airportDirs = entries.filter((entry) => entry.isDirectory());

  for (const airportDir of airportDirs) {
    const airportIcao = airportDir.name;
    const airportChartsPath = path.join(csvDir, airportIcao, "Charts.csv");

    try {
      // Check if Charts.csv exists in this airport directory
      await fs.access(airportChartsPath);

      // Read and parse the airport-specific Charts.csv
      const buffer = await fs.readFile(airportChartsPath);
      const csvContent = iconv.decode(buffer, "GBK");

      const charts = parsePerAirportCSV(csvContent, airportIcao);
      allCharts.push(...charts);
    } catch {
      // Skip directories without Charts.csv
      console.warn(`No Charts.csv found for airport: ${airportIcao}`);
    }
  }

  return allCharts;
}

async function loadChartsFromDirectory(dirPath: string): Promise<ChartData[]> {
  try {
    const format = await detectFormat(dirPath);
    console.log(`Detected format in ${dirPath}: ${format}`);
    return format === "old"
      ? await loadOldFormat(dirPath)
      : await loadNewFormat(dirPath);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const config = await getConfig();
    const csvDir = resolveConfigDir(config.csvDirectory);
    const chartsDir = resolveConfigDir(config.chartsDirectory);

    const chartsFromCsvDir = await loadChartsFromDirectory(csvDir);

    // If no charts found in csvDirectory, try chartsDirectory
    const charts =
      chartsFromCsvDir.length > 0 || csvDir === chartsDir
        ? chartsFromCsvDir
        : await loadChartsFromDirectory(chartsDir);

    const groupedCharts = groupChartsByAirport(charts);

    return NextResponse.json({
      success: true,
      data: groupedCharts,
    });
  } catch (error) {
    console.error("Error reading CSV:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load chart data" },
      { status: 500 }
    );
  }
}
