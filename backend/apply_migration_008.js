import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkInstallationTable() {
  console.log('--- Checking installation_checklists table in Supabase ---');
  const { data, error } = await supabase
    .from('installation_checklists')
    .select('*')
    .limit(1);

  if (error) {
    console.log('Table installation_checklists check error:', error.message);
  } else {
    console.log('Table installation_checklists exists and accessible! Rows:', data.length);
  }

  // Also check sequence function
  const { data: numData, error: numError } = await supabase.rpc('generate_next_installation_checklist_number');
  if (numError) {
    console.log('RPC generate_next_installation_checklist_number error:', numError.message);
  } else {
    console.log('Generated test checklist number via RPC:', numData);
  }
}

checkInstallationTable().catch(console.error);
