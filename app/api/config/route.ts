import { NextResponse } from "next/server";
import { getConfig, saveConfig, validateDirectory } from "@/lib/configManager";
import { AppConfig } from "@/types/config";

export async function GET() {
  try {
    const config = await getConfig();
    return NextResponse.json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error("Error reading config:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load configuration" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const newConfig: AppConfig = await request.json();

    // Validate both directories
    const chartsValidation = await validateDirectory(newConfig.chartsDirectory);
    const csvValidation = await validateDirectory(newConfig.csvDirectory);

    const errors: string[] = [];

    if (!chartsValidation.valid) {
      errors.push(`Charts directory: ${chartsValidation.error}`);
    }

    if (!csvValidation.valid) {
      errors.push(`CSV directory: ${csvValidation.error}`);
    }

    if (errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid directories",
          details: errors,
        },
        { status: 400 }
      );
    }

    // Save the config
    await saveConfig(newConfig);

    return NextResponse.json({
      success: true,
      message: "Configuration saved successfully",
      data: newConfig,
    });
  } catch (error) {
    console.error("Error saving config:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save configuration" },
      { status: 500 }
    );
  }
}
