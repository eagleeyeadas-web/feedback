import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '../backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadLogo() {
  const logoPath = path.resolve('../frontend/public/logo.png');
  const fileData = fs.readFileSync(logoPath);

  // Check if assets bucket exists, or create/upload
  const { data, error } = await supabase.storage
    .from('assets')
    .upload('logo.png', fileData, {
      contentType: 'image/png',
      upsert: true,
    });

  if (error) {
    console.error('Error uploading logo to Supabase assets bucket:', error);
  } else {
    console.log('Logo uploaded successfully to Supabase assets/logo.png:', data);
  }
}

uploadLogo();
