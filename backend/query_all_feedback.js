import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkAll() {
  const { data, error } = await supabase.from('feedback').select('*');
  if (error) {
    console.error('Error selecting feedback:', error);
  } else {
    console.log('Total feedback records stored in Supabase:', data.length);
    console.log('Records details:', JSON.stringify(data, null, 2));
  }
}

checkAll();
