import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { parseCSV, parsePerAirportCSV, groupChartsByAirport } from '@/lib/chartParser';
import { getConfig } from '@/lib/configManager';
import { ChartData } from '@/types/chart';

async function detectFormat(csvDir: string): Promise<'old' | 'new'> {
  try {
    const csvPath = path.join(csvDir, 'Charts.csv');
    const buffer = await fs.readFile(csvPath);
    const csvContent = iconv.decode(buffer, 'GBK');

    // Check if this is the new format (minimal Charts.csv with just header)
    const lines = csvContent.trim().split('\n');

    // If Charts.csv has only 1 line (header) or very few lines, it's likely the new format
    if (lines.length <= 1) {
      return 'new';
    }

    // Check if the first data line has AirportIcao column
    const header = lines[0].toLowerCase();
    if (header.includes('airporticao')) {
      return 'old';
    }

    return 'new';
  } catch (error) {
    // If Charts.csv doesn't exist, assume new format
    return 'new';
  }
}

async function loadOldFormat(csvDir: string): Promise<ChartData[]> {
  const csvPath = path.join(csvDir, 'Charts.csv');
  const buffer = await fs.readFile(csvPath);
  const csvContent = iconv.decode(buffer, 'GBK');
  return parseCSV(csvContent);
}

async function loadNewFormat(csvDir: string): Promise<ChartData[]> {
  const allCharts: ChartData[] = [];

  // Read all directories in csvDir
  const entries = await fs.readdir(csvDir, { withFileTypes: true });

  // Filter for directories (airport folders)
  const airportDirs = entries.filter(entry => entry.isDirectory());

  for (const airportDir of airportDirs) {
    const airportIcao = airportDir.name;
    const airportChartsPath = path.join(csvDir, airportIcao, 'Charts.csv');

    try {
      // Check if Charts.csv exists in this airport directory
      await fs.access(airportChartsPath);

      // Read and parse the airport-specific Charts.csv
      const buffer = await fs.readFile(airportChartsPath);
      const csvContent = iconv.decode(buffer, 'GBK');

      const charts = parsePerAirportCSV(csvContent, airportIcao);
      allCharts.push(...charts);
    } catch (error) {
      // Skip directories without Charts.csv
      console.warn(`No Charts.csv found for airport: ${airportIcao}`);
    }
  }

  return allCharts;
}

export async function GET() {
  try {
    const config = await getConfig();
    const csvDir = path.isAbsolute(config.csvDirectory)
      ? config.csvDirectory
      : path.join(process.cwd(), config.csvDirectory);

    // Detect which format we're dealing with
    const format = await detectFormat(csvDir);
    console.log(`Detected format: ${format}`);

    // Load charts based on format
    const charts = format === 'old'
      ? await loadOldFormat(csvDir)
      : await loadNewFormat(csvDir);

    const groupedCharts = groupChartsByAirport(charts);

    return NextResponse.json({
      success: true,
      data: groupedCharts,
    });
  } catch (error) {
    console.error('Error reading CSV:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load chart data' },
      { status: 500 }
    );
  }
}

