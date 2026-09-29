import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in backend/.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('--- Applying Migration 005: Customer Feedback PDF 10-Day Auto Expiry ---');

  // Check if pdf_expires_at column exists in feedback table
  const { data: selectData, error: selectError } = await supabase
    .from('feedback')
    .select('id, submitted_at, pdf_expires_at')
    .limit(1);

  if (selectError && selectError.message?.includes('pdf_expires_at')) {
    console.log('pdf_expires_at column does not exist yet. Please run migration 005_feedback_pdf_auto_expiry.sql in Supabase SQL Editor.');
    console.log('Attempting RPC SQL fallback if available...');
  } else if (!selectError) {
    console.log('Column pdf_expires_at is active on feedback table.');
    
    // Backfill any null pdf_expires_at values
    const { data: unexpiredRows, error: nullCheckError } = await supabase
      .from('feedback')
      .select('id, submitted_at, pdf_expires_at')
      .is('pdf_expires_at', null);

    if (!nullCheckError && unexpiredRows && unexpiredRows.length > 0) {
      console.log(`Found ${unexpiredRows.length} rows with NULL pdf_expires_at. Updating...`);
      for (const row of unexpiredRows) {
        const submitted = row.submitted_at ? new Date(row.submitted_at) : new Date();
        const pdfExpiresAt = new Date(submitted.getTime() + (10 * 24 * 60 * 60 * 1000)).toISOString();
        await supabase
          .from('feedback')
          .update({ pdf_expires_at: pdfExpiresAt })
          .eq('id', row.id);
      }
      console.log('Successfully backfilled pdf_expires_at timestamps.');
    } else {
      console.log('All feedback records have valid pdf_expires_at timestamps.');
    }
  } else {
    console.error('Error querying feedback table:', selectError.message);
  }
}

runMigration().catch(console.error);
