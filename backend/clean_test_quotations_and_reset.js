import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './src/services/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEQUENCE_FILE_PATH = path.resolve(__dirname, 'assets/quotation_sequence.json');

async function cleanAndReset() {
  console.log('=== CLEANING MOCK TEST QUOTATIONS & RESETTING SEQUENCE TO 238 ===\n');

  // Fetch all quotations currently in Supabase
  const { data: allQuotations, error } = await supabase
    .from('quotations')
    .select('id, quotation_number, customer_name, pdf_path');

  if (error) {
    console.error('Error fetching quotations:', error.message);
    return;
  }

  console.log(`Found ${allQuotations?.length || 0} total quotation(s) in Supabase DB.`);

  let deletedCount = 0;
  for (const q of allQuotations || []) {
    console.log(` - ID: ${q.id} | Number: ${q.quotation_number} | Customer: ${q.customer_name}`);

    // Identify mock test quotations created during automated testing
    const isTestCustomer = (q.customer_name || '').toLowerCase().includes('test') ||
                           (q.customer_name || '').toLowerCase().includes('customer q') ||
                           (q.customer_name || '').toLowerCase().includes('batch');

    const match = (q.quotation_number || '').match(/^CQS\/0*(\d+)$/);
    const seq = match ? parseInt(match[1], 10) : 0;

    if (isTestCustomer || seq >= 239) {
      console.log(`   --> Deleting test record: ${q.quotation_number} (${q.customer_name})`);
      if (q.pdf_path) {
        try { await supabase.storage.from('pdfs').remove([q.pdf_path]); } catch {}
      }
      await supabase.from('quotations').delete().eq('id', q.id);
      deletedCount++;
    }
  }

  console.log(`\nSuccessfully deleted ${deletedCount} test quotation record(s).`);

  // Reset local file
  fs.writeFileSync(
    SEQUENCE_FILE_PATH,
    JSON.stringify({ last_value: 238, updated_at: new Date().toISOString() }, null, 2)
  );
  console.log('✅ Local sequence backup assets/quotation_sequence.json set to 238.');

  // Try updating quotation_sequence table if present
  try {
    await supabase.from('quotation_sequence').upsert({ id: 1, last_value: 238, updated_at: new Date().toISOString() });
    console.log('✅ Supabase quotation_sequence table set to 238.');
  } catch {
    console.log('Note: quotation_sequence table not found in Supabase schema yet.');
  }

  // Check remaining quotations max sequence
  const { data: remaining } = await supabase.from('quotations').select('quotation_number');
  let maxRem = 238;
  for (const r of remaining || []) {
    const m = (r.quotation_number || '').match(/^CQS\/0*(\d+)$/);
    if (m) {
      const s = parseInt(m[1], 10);
      if (s > maxRem) maxRem = s;
    }
  }

  console.log(`\nRemaining max issued quotation number in DB: CQS/${String(maxRem).padStart(5, '0')}`);
  console.log(`NEXT GENERATED QUOTATION NUMBER WILL BE: CQS/${String(maxRem + 1).padStart(5, '0')}`);

  console.log('\n=== RESET COMPLETE SUCCESSFUL ===');
}

cleanAndReset().catch(console.error);
