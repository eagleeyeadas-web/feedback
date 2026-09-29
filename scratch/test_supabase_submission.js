import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Testing Supabase Connection...');
console.log('URL:', supabaseUrl);
console.log('Key exists:', !!supabaseKey);

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSupabase() {
  console.log('\n--- 1. Testing RPC generate_feedback_id ---');
  const { data: idData, error: idError } = await supabase.rpc('generate_feedback_id');
  if (idError) {
    console.error('RPC generate_feedback_id ERROR:', idError);
  } else {
    console.log('RPC generate_feedback_id SUCCESS:', idData);
  }

  console.log('\n--- 2. Testing Tables in Database ---');
  const { data: tableData, error: tableError } = await supabase.from('feedback').select('*').limit(1);
  if (tableError) {
    console.error('Select from feedback table ERROR:', tableError);
  } else {
    console.log('Select from feedback table SUCCESS. Found rows:', tableData.length);
  }

  console.log('\n--- 3. Testing Storage Buckets ---');
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) {
    console.error('List storage buckets ERROR:', bucketError);
  } else {
    console.log('Storage Buckets:', buckets.map(b => b.name));
  }
}

testSupabase();
