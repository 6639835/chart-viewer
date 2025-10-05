const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

const SIZES = {
  'icon-1024.png': 1024,
  'icon-512.png': 512,
  'icon-256.png': 256,
  'icon.png': 1024, // Main icon for electron-builder
};

async function generateIcons() {
  console.log('🎨 Generating icons from SVG...\n');
  
  const svgPath = path.join(__dirname, '..', 'public', 'icon.svg');
  const outputDir = path.join(__dirname, '..', 'public');
  
  try {
    // Check if SVG exists
    await fs.access(svgPath);
    
    // Generate PNG icons
    for (const [filename, size] of Object.entries(SIZES)) {
      const outputPath = path.join(outputDir, filename);
      
      await sharp(svgPath)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      
      console.log(`✅ Generated: ${filename} (${size}x${size})`);
    }
    
    console.log('\n✨ All icons generated successfully!');
    console.log('\n📁 Icon files location: public/');
    console.log('   - icon.png (main icon for all platforms)');
    console.log('   - icon-1024.png (high resolution)');
    console.log('   - icon-512.png (standard)');
    console.log('   - icon-256.png (small)');
    console.log('\n💡 Electron-builder will use icon.png and generate platform-specific formats automatically.');
    
  } catch (error) {
    console.error('❌ Error generating icons:', error.message);
    process.exit(1);
  }
}

generateIcons();
