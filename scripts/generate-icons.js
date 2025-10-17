const sharp = require("sharp");
const fs = require("fs").promises;
const path = require("path");
const pngToIco = require("png-to-ico").default || require("png-to-ico");

const SIZES = {
  "icon-1024.png": 1024,
  "icon-512.png": 512,
  "icon-256.png": 256,
  "icon.png": 1024, // Main icon for electron-builder
};

async function generateIcons() {
  console.log("🎨 Generating icons from SVG...\n");

  const svgPath = path.join(__dirname, "..", "public", "icon.svg");
  const outputDir = path.join(__dirname, "..", "public");

  try {
    // Check if SVG exists
    await fs.access(svgPath);

    // Generate PNG icons
    for (const [filename, size] of Object.entries(SIZES)) {
      const outputPath = path.join(outputDir, filename);

      await sharp(svgPath).resize(size, size).png().toFile(outputPath);

      console.log(`✅ Generated: ${filename} (${size}x${size})`);
    }

    // Generate .ico for Windows (multiple sizes in one file)
    console.log("\n🪟 Generating Windows .ico file...");
    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    const icoTempFiles = [];

    for (const size of icoSizes) {
      const tempPath = path.join(outputDir, `temp-${size}.png`);
      await sharp(svgPath).resize(size, size).png().toFile(tempPath);
      icoTempFiles.push(tempPath);
    }

    const icoBuffer = await pngToIco(icoTempFiles);
    await fs.writeFile(path.join(outputDir, "icon.ico"), icoBuffer);
    console.log("✅ Generated: icon.ico (multi-size)");

    // Clean up temp files
    for (const tempFile of icoTempFiles) {
      await fs.unlink(tempFile);
    }

    // Generate .icns for macOS (requires iconutil, macOS only)
    if (process.platform === "darwin") {
      console.log("\n🍎 Generating macOS .icns file...");
      const { exec } = require("child_process");
      const { promisify } = require("util");
      const execPromise = promisify(exec);

      const iconsetDir = path.join(outputDir, "icon.iconset");
      await fs.mkdir(iconsetDir, { recursive: true });

      const icnsSizes = [
        { size: 16, scale: 1 },
        { size: 16, scale: 2 },
        { size: 32, scale: 1 },
        { size: 32, scale: 2 },
        { size: 128, scale: 1 },
        { size: 128, scale: 2 },
        { size: 256, scale: 1 },
        { size: 256, scale: 2 },
        { size: 512, scale: 1 },
        { size: 512, scale: 2 },
      ];

      for (const { size, scale } of icnsSizes) {
        const actualSize = size * scale;
        const filename =
          scale === 1
            ? `icon_${size}x${size}.png`
            : `icon_${size}x${size}@2x.png`;
        const filePath = path.join(iconsetDir, filename);

        await sharp(svgPath)
          .resize(actualSize, actualSize)
          .png()
          .toFile(filePath);
      }

      try {
        await execPromise(
          `iconutil -c icns "${iconsetDir}" -o "${path.join(outputDir, "icon.icns")}"`
        );
        console.log("✅ Generated: icon.icns (macOS format)");

        // Clean up iconset directory
        await fs.rm(iconsetDir, { recursive: true, force: true });
      } catch (error) {
        console.log("⚠️  Could not generate .icns (iconutil not available)");
      }
    }

    console.log("\n✨ All icons generated successfully!");
    console.log("\n📁 Icon files location: public/");
    console.log("   - icon.png (main icon)");
    console.log("   - icon.ico (Windows format)");
    if (process.platform === "darwin") {
      console.log("   - icon.icns (macOS format)");
    }
    console.log(
      "   - icon-1024.png, icon-512.png, icon-256.png (various sizes)"
    );
  } catch (error) {
    console.error("❌ Error generating icons:", error.message);
    process.exit(1);
  }
}

generateIcons();
