import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { parseCSV, groupChartsByAirport } from '@/lib/chartParser';
import { getConfig } from '@/lib/configManager';

export async function GET() {
  try {
    const config = await getConfig();
    const csvDir = path.isAbsolute(config.csvDirectory)
      ? config.csvDirectory
      : path.join(process.cwd(), config.csvDirectory);
    const csvPath = path.join(csvDir, 'Charts.csv');
    
    // Read file as buffer first
    const buffer = await fs.readFile(csvPath);
    
    // Convert from GBK to UTF-8
    const csvContent = iconv.decode(buffer, 'GBK');
    
    const charts = parseCSV(csvContent);
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

