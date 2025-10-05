import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getConfig } from '@/lib/configManager';

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
    const pdfPath = path.join(chartsDir, filename);
    
    // Check if file exists
    try {
      await fs.access(pdfPath);
    } catch {
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

