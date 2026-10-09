import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './src/services/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEQUENCE_FILE_PATH = path.resolve(__dirname, 'assets/quotation_sequence.json');

async function resetSequence() {
  console.log('=== RESETTING QUOTATION SEQUENCE TO 238 (NEXT WILL BE CQS/00239) ===\n');

  // 1. Delete test quotations created with sequence >= 239
  const { data: testQuotations } = await supabase
    .from('quotations')
    .select('id, quotation_number, pdf_path');

  if (testQuotations && testQuotations.length > 0) {
    for (const q of testQuotations) {
      if (q.quotation_number && q.quotation_number.match(/^CQS\/002(39|40|41|42|43|44|45)$/)) {
        console.log(`Cleaning up test quotation record: ${q.quotation_number} (ID: ${q.id})`);
        if (q.pdf_path) {
          try {
            await supabase.storage.from('pdfs').remove([q.pdf_path]);
          } catch { /* ignore */ }
        }
        await supabase.from('quotations').delete().eq('id', q.id);
      }
    }
  }

  // 2. Reset Supabase quotation_sequence table row to 238
  try {
    const { data: upsertData, error: upsertError } = await supabase
      .from('quotation_sequence')
      .upsert({
        id: 1,
        last_value: 238,
        updated_at: new Date().toISOString(),
      })
      .select();

    if (upsertError) {
      console.error('Error updating quotation_sequence table in Supabase:', upsertError.message);
    } else {
      console.log('✅ Supabase quotation_sequence table last_value successfully reset to 238!');
    }
  } catch (err) {
    console.error('Exception updating Supabase quotation_sequence:', err.message);
  }

  // 3. Reset local json file assets/quotation_sequence.json to 238
  try {
    fs.writeFileSync(
      SEQUENCE_FILE_PATH,
      JSON.stringify({ last_value: 238, updated_at: new Date().toISOString() }, null, 2)
    );
    console.log('✅ Local file assets/quotation_sequence.json successfully reset to 238!');
  } catch (err) {
    console.error('Error updating local sequence file:', err.message);
  }

  // 4. Verify preview
  const { data: seqRow } = await supabase
    .from('quotation_sequence')
    .select('last_value')
    .eq('id', 1)
    .single();

  console.log(`\nCurrent Database Sequence Counter last_value: ${seqRow?.last_value}`);
  const nextVal = (seqRow?.last_value || 238) + 1;
  console.log(`Next Quotation Number to be generated: CQS/${String(nextVal).padStart(5, '0')}`);

  console.log('\n=== RESET COMPLETE SUCCESSFUL ===');
}

resetSequence().catch(console.error);
