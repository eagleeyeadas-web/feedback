import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generatePushNotificationIcons() {
  const backendAssetsDir = path.resolve(__dirname, '../../assets');
  const frontendPublicDir = path.resolve(__dirname, '../../../frontend/public');
  const frontendDistDir = path.resolve(__dirname, '../../../frontend/dist');

  const logoCleanPath = path.join(backendAssetsDir, 'logo_clean.png');
  if (!fs.existsSync(logoCleanPath)) {
    throw new Error(`Base logo not found at: ${logoCleanPath}`);
  }

  console.log('Using authentic Eagle Eye logo from:', logoCleanPath);
  const logoMeta = await sharp(logoCleanPath).metadata();
  console.log(`Base logo dimensions: ${logoMeta.width}x${logoMeta.height}`);

  // --------------------------------------------------------------------------
  // 1. EXTRACT EMBLEM FOR MONOCHROME BADGE
  // --------------------------------------------------------------------------
  // The bird/wings shield emblem is located from y=0 to y=103 (width=118)
  const emblemRaw = await sharp(logoCleanPath)
    .extract({ left: 0, top: 0, width: 118, height: 103 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Convert to pure white silhouette: R=255, G=255, B=255, preserving smooth alpha edges
  const emblemWhiteData = Buffer.from(emblemRaw.data);
  for (let i = 0; i < emblemWhiteData.length; i += 4) {
    const a = emblemWhiteData[i + 3];
    if (a > 15) {
      emblemWhiteData[i] = 255;
      emblemWhiteData[i + 1] = 255;
      emblemWhiteData[i + 2] = 255;
    } else {
      emblemWhiteData[i + 3] = 0;
    }
  }

  // Helper to generate a monochrome badge of specific square dimension with safe padding
  async function createMonochromeBadge(targetSize) {
    const padding = Math.round(targetSize * 0.12); // 12% padding for Android circular badge cutout
    const innerSize = targetSize - (padding * 2);

    const resized = await sharp(emblemWhiteData, {
      raw: { width: emblemRaw.info.width, height: emblemRaw.info.height, channels: 4 }
    })
      .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({
        top: padding,
        bottom: targetSize - innerSize - padding,
        left: padding,
        right: targetSize - innerSize - padding,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Ensure all visible pixels remain 100% pure white (#FFFFFF) with their alpha intact
    const finalData = Buffer.from(resized.data);
    for (let i = 0; i < finalData.length; i += 4) {
      finalData[i] = 255;
      finalData[i + 1] = 255;
      finalData[i + 2] = 255;
    }

    return await sharp(finalData, {
      raw: { width: targetSize, height: targetSize, channels: 4 }
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  const badge96Buffer = await createMonochromeBadge(96);
  const badge72Buffer = await createMonochromeBadge(72);
  const badge48Buffer = await createMonochromeBadge(48);

  // --------------------------------------------------------------------------
  // 2. LARGE NOTIFICATION ICON & APP ICONS (FULL COLOR ON TRANSPARENT BG)
  // --------------------------------------------------------------------------
  // Centered with safe margins so Android's circular large-icon crop never clips the logo
  async function createLargeIcon(targetSize) {
    const innerSize = Math.round(targetSize * 0.82);
    const pad = Math.floor((targetSize - innerSize) / 2);
    const padExtra = targetSize - innerSize - (pad * 2);

    return await sharp(logoCleanPath)
      .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({
        top: pad,
        bottom: pad + padExtra,
        left: pad,
        right: pad + padExtra,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  const icon192Buffer = await createLargeIcon(192);
  const icon512Buffer = await createLargeIcon(512);

  // --------------------------------------------------------------------------
  // 3. MASKABLE PWA ICONS (FULL COLOR ON THEME BACKGROUND WITH SAFE ZONE)
  // --------------------------------------------------------------------------
  async function createMaskableIcon(targetSize) {
    const innerSize = Math.round(targetSize * 0.65); // 65% safe zone for maskable clipping
    const pad = Math.floor((targetSize - innerSize) / 2);
    const padExtra = targetSize - innerSize - (pad * 2);

    return await sharp(logoCleanPath)
      .resize(innerSize, innerSize, { fit: 'contain', background: { r: 10, g: 25, b: 70, alpha: 1 } })
      .extend({
        top: pad,
        bottom: pad + padExtra,
        left: pad,
        right: pad + padExtra,
        background: { r: 10, g: 25, b: 70, alpha: 1 }, // #0a1946 theme color
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  const maskable192Buffer = await createMaskableIcon(192);
  const maskable512Buffer = await createMaskableIcon(512);

  // --------------------------------------------------------------------------
  // 4. WRITE ALL FILES TO frontend/public (AND frontend/dist IF PRESENT)
  // --------------------------------------------------------------------------
  const filesToWrite = [
    { name: 'badge-96.png', buffer: badge96Buffer },
    { name: 'badge-72.png', buffer: badge72Buffer },
    { name: 'badge-48.png', buffer: badge48Buffer },
    { name: 'badge.png', buffer: badge96Buffer },
    { name: 'icon-badge-96.png', buffer: badge96Buffer },
    { name: 'icon-badge.png', buffer: badge96Buffer },
    { name: 'icon-192.png', buffer: icon192Buffer },
    { name: 'icon-512.png', buffer: icon512Buffer },
    { name: 'icon-maskable-192.png', buffer: maskable192Buffer },
    { name: 'icon-maskable-512.png', buffer: maskable512Buffer },
  ];

  const targetDirs = [frontendPublicDir];
  if (fs.existsSync(frontendDistDir)) {
    targetDirs.push(frontendDistDir);
  }

  for (const dir of targetDirs) {
    for (const file of filesToWrite) {
      const outPath = path.join(dir, file.name);
      fs.writeFileSync(outPath, file.buffer);
      console.log(`✓ Wrote ${file.name} to ${outPath} (${file.buffer.length} bytes)`);
    }
  }

  console.log('\nAll notification icon and badge assets generated successfully.');
}

generatePushNotificationIcons().catch((err) => {
  console.error('Failed to generate push notification icons:', err);
  process.exit(1);
});
