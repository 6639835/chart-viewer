import { NextResponse } from "next/server";
import packageJson from "@/package.json";

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      version: packageJson.version,
      name: packageJson.name,
      author: packageJson.author,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to get version" },
      { status: 500 }
    );
  }
}
