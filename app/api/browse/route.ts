import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function POST(request: Request) {
  try {
    const { dirPath } = await request.json();

    // Default to project root if no path provided
    const targetPath = dirPath || process.cwd();

    // Convert to absolute path if relative
    const absolutePath = path.isAbsolute(targetPath)
      ? targetPath
      : path.join(process.cwd(), targetPath);

    // Security check: prevent accessing sensitive directories
    const normalizedPath = path.normalize(absolutePath);

    // Check if directory exists and is readable
    try {
      const stats = await fs.stat(normalizedPath);
      if (!stats.isDirectory()) {
        return NextResponse.json(
          { success: false, error: "Path is not a directory" },
          { status: 400 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        { success: false, error: "Directory not accessible" },
        { status: 400 }
      );
    }

    // Read directory contents
    const entries = await fs.readdir(normalizedPath, { withFileTypes: true });

    // Filter and format results
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(normalizedPath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Add parent directory option if not at root
    const parentPath = path.dirname(normalizedPath);
    const canGoUp = parentPath !== normalizedPath;

    return NextResponse.json({
      success: true,
      data: {
        currentPath: normalizedPath,
        parentPath: canGoUp ? parentPath : null,
        directories,
      },
    });
  } catch (error) {
    console.error("Error browsing directory:", error);
    return NextResponse.json(
      { success: false, error: "Failed to browse directory" },
      { status: 500 }
    );
  }
}
