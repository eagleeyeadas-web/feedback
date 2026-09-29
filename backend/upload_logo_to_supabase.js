import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function uploadLogo() {
  const logoPath = path.resolve(__dirname, 'assets/logo.png');
  const fileData = fs.readFileSync(logoPath);

  const { data, error } = await supabase.storage
    .from('assets')
    .upload('logo.png', fileData, {
      contentType: 'image/png',
      upsert: true,
    });

  if (error) {
    console.error('Error uploading logo:', error);
  } else {
    console.log('Successfully updated logo.png in Supabase assets bucket:', data);
  }
}

uploadLogo();
