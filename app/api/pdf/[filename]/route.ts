import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getConfig } from '@/lib/configManager';

/**
 * Finds PDF file in either format:
 * - Format 1 (flat): charts/ZBAA-AD2-ZBAA-1-1.pdf
 * - Format 2 (nested): charts/ZBAA/ZBAA-AD2-ZBAA-1-1.pdf
 */
async function findPdfPath(chartsDir: string, filename: string): Promise<string | null> {
  // Extract airport ICAO code from filename (first 4 characters before first hyphen)
  const icaoMatch = filename.match(/^([A-Z]{4})-/);
  
  if (icaoMatch) {
    const icaoCode = icaoMatch[1];
    
    // Try Format 2 (nested): charts/ICAO/filename
    const nestedPath = path.join(chartsDir, icaoCode, filename);
    try {
      await fs.access(nestedPath);
      return nestedPath;
    } catch {
      // File not found in nested format, continue to try flat format
    }
  }
  
  // Try Format 1 (flat): charts/filename
  const flatPath = path.join(chartsDir, filename);
  try {
    await fs.access(flatPath);
    return flatPath;
  } catch {
    // File not found in either format
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: { filename: string } }
) {
  try {
    // Decode URI component to handle Chinese characters
    const filename = decodeURIComponent(params.filename);
    
    const config = await getConfig();
    const chartsDir = path.isAbsolute(config.chartsDirectory)
      ? config.chartsDirectory
      : path.join(process.cwd(), config.chartsDirectory);
    
    // Find PDF in either format
    const pdfPath = await findPdfPath(chartsDir, filename);
    
    if (!pdfPath) {
      return NextResponse.json(
        { error: 'PDF file not found' },
        { status: 404 }
      );
    }
    
    const pdfBuffer = await fs.readFile(pdfPath);
    
    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (error) {
    console.error('Error serving PDF:', error);
    return NextResponse.json(
      { error: 'Failed to load PDF' },
      { status: 500 }
    );
  }
}

