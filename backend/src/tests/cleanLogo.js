import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

async function processCleanLogo() {
  const logoPath = path.resolve(process.cwd(), 'assets/logo.png');
  const buffer = fs.readFileSync(logoPath);

  // Load raw RGBA pixels
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Convert light grey / white background pixels to transparent
  // Light grey / white background has R, G, B > 220
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // If pixel is white or light grey (R > 210, G > 210, B > 210), make alpha 0
    if (r > 210 && g > 210 && b > 210) {
      data[i + 3] = 0; // Set Alpha to 0 (transparent)
    }
  }

  // Create clean transparent PNG from raw pixels
  const transparentBuffer = await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    }
  })
  .png()
  .trim() // Trim transparent outer padding
  .toBuffer();

  const finalMeta = await sharp(transparentBuffer).metadata();
  console.log('Clean Logo Final Metadata:', finalMeta);

  // Save clean transparent logo to assets/logo_clean.png
  const cleanPath = path.resolve(process.cwd(), 'assets/logo_clean.png');
  fs.writeFileSync(cleanPath, transparentBuffer);
  console.log('Saved clean transparent logo to:', cleanPath);

  // Also replace assets/logo.png with this clean transparent logo!
  const mainLogoPath = path.resolve(process.cwd(), 'assets/logo.png');
  fs.writeFileSync(mainLogoPath, transparentBuffer);
  console.log('Updated main assets/logo.png with clean transparent logo.');
}

processCleanLogo().catch(console.error);
