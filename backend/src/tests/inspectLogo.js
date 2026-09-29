import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

async function inspectLogo() {
  const logoPath = path.resolve(process.cwd(), 'assets/logo.png');
  console.log('Inspecting logo at:', logoPath);

  if (!fs.existsSync(logoPath)) {
    console.error('Logo file not found!');
    return;
  }

  const image = sharp(logoPath);
  const metadata = await image.metadata();
  console.log('Original Logo Metadata:', metadata);

  // Trim excess background whitespace / grey borders
  const trimmedBuffer = await image
    .trim() // Trims pixels of similar color to outer border
    .toBuffer();

  const trimmedMeta = await sharp(trimmedBuffer).metadata();
  console.log('Trimmed Logo Metadata:', trimmedMeta);

  // Save trimmed transparent logo as assets/logo_trimmed.png
  const trimmedPath = path.resolve(process.cwd(), 'assets/logo_trimmed.png');
  fs.writeFileSync(trimmedPath, trimmedBuffer);
  console.log('Saved clean trimmed logo to:', trimmedPath);
}

inspectLogo().catch(console.error);
