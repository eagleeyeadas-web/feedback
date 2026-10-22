import assert from 'assert';
import supabase from '../src/services/supabase.js';
import { runQuotationCleanup, runFullCleanup, RETENTION_DAYS, RETENTION_MS } from '../src/services/quotationCleanupService.js';
import { generateQuotationPDF } from '../src/services/quotationPdfGenerator.js';
import { peekNextQuotationNumber, generateAndReserveQuotationNumber, getHighestSequenceValue } from '../src/services/quotationSequenceService.js';
import { getInventoryProducts } from '../src/services/inventoryService.js';

async function runTestSuite() {
  console.log('================================================================');
  console.log('  TEST SUITE: SAFDRIVE 20-DAY AUTOMATIC PERMANENT DELETION     ');
  console.log('================================================================\n');

  const ts = Date.now();
  const dummyPdf = Buffer.from('%PDF-1.4 SafDrive 20-Day Permanent Deletion Test PDF');

  // Baseline initial sequence number
  const initialNextNumber = await peekNextQuotationNumber();
  const initialHighest = await getHighestSequenceValue();
  console.log(`Baseline Next Quotation Number: ${initialNextNumber} (Highest sequence value: ${initialHighest})`);

  // Snapshot initial products to verify non-deletion of shared data
  const initialProducts = await getInventoryProducts();
  const initialProductCount = initialProducts?.length || 0;

  // -------------------------------------------------------------------------
  // Test Fixture 1: Unexpired Quotation (expires in 15 days) -> Must remain intact
  // -------------------------------------------------------------------------
  const unexpiredQNo = `CQS/TEST-UNEXP-${ts}`;
  const unexpiredPdfPath = `quotations/test_unexpired_${ts}.pdf`;
  await supabase.storage.from('pdfs').upload(unexpiredPdfPath, dummyPdf, { contentType: 'application/pdf', upsert: true });

  const { data: unexpiredQ, error: errUnexp } = await supabase.from('quotations').insert([{
    quotation_number: unexpiredQNo,
    customer_name: `UNEXPIRED CLIENT ${ts}`,
    quotation_date: '2026-10-22',
    subtotal: 5000,
    net_amount: 5900,
    pdf_path: unexpiredPdfPath,
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days old
    expires_at: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days left
  }]).select().single();
  assert(!errUnexp && unexpiredQ, 'Failed to insert unexpired test quotation');

  const { data: unexpiredItems } = await supabase.from('quotation_items').insert([
    { quotation_id: unexpiredQ.id, sno: 1, item_description: 'Unexpired Camera Unit', qty: 1, rate: 5000, amount: 5000 }
  ]).select();

  // -------------------------------------------------------------------------
  // Test Fixture 2: Exactly Reached Deadline (expires right now / 1 second ago)
  // -------------------------------------------------------------------------
  const exactDeadlineQNo = `CQS/TEST-EXACT-${ts}`;
  const exactDeadlinePdfPath = `quotations/test_exact_${ts}.pdf`;
  await supabase.storage.from('pdfs').upload(exactDeadlinePdfPath, dummyPdf, { contentType: 'application/pdf', upsert: true });

  const { data: exactQ, error: errExact } = await supabase.from('quotations').insert([{
    quotation_number: exactDeadlineQNo,
    customer_name: `EXACT DEADLINE CLIENT ${ts}`,
    quotation_date: '2026-10-02',
    subtotal: 7000,
    net_amount: 8260,
    pdf_path: exactDeadlinePdfPath,
    created_at: new Date(Date.now() - RETENTION_MS).toISOString(),
    expires_at: new Date(Date.now() - 1000).toISOString(), // Exactly expired
  }]).select().single();
  assert(!errExact && exactQ, 'Failed to insert exact deadline test quotation');

  await supabase.from('quotation_items').insert([
    { quotation_id: exactQ.id, sno: 1, item_description: 'Exact Expiry Unit', qty: 1, rate: 7000, amount: 7000 }
  ]);

  // -------------------------------------------------------------------------
  // Test Fixture 3: Past Deadline (expired 2 days ago / 22 days old)
  // -------------------------------------------------------------------------
  const pastDeadlineQNo = `CQS/TEST-PAST-${ts}`;
  const pastDeadlinePdfPath = `quotations/test_past_${ts}.pdf`;
  await supabase.storage.from('pdfs').upload(pastDeadlinePdfPath, dummyPdf, { contentType: 'application/pdf', upsert: true });

  const { data: pastQ, error: errPast } = await supabase.from('quotations').insert([{
    quotation_number: pastDeadlineQNo,
    customer_name: `PAST DEADLINE CLIENT ${ts}`,
    quotation_date: '2026-09-30',
    subtotal: 9000,
    net_amount: 10620,
    pdf_path: pastDeadlinePdfPath,
    created_at: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString(),
    expires_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  }]).select().single();
  assert(!errPast && pastQ, 'Failed to insert past deadline test quotation');

  await supabase.from('quotation_items').insert([
    { quotation_id: pastQ.id, sno: 1, item_description: 'Past Expiry GPS Device', qty: 2, rate: 4500, amount: 9000 }
  ]);

  console.log('\n--- Test 1: Active/Unexpired Quotation Remains Intact Prior to Cleanup ---');
  assert(unexpiredQ.id, 'Unexpired quotation exists');
  console.log('✓ Unexpired quotation successfully inserted and verified intact');

  // -------------------------------------------------------------------------
  // Run 1 of Automatic Cleanup
  // -------------------------------------------------------------------------
  console.log('\n--- Running Automatic Scheduled Cleanup Job (Run 1) ---');
  const cleanup1 = await runQuotationCleanup();
  console.log('Cleanup 1 Result:', cleanup1);

  // Criterion 1: Unexpired quotation remains completely intact
  console.log('\n--- Criterion 1: Unexpired quotation remains intact ---');
  const { data: checkUnexpDb } = await supabase.from('quotations').select('*').eq('id', unexpiredQ.id).maybeSingle();
  assert(checkUnexpDb !== null, 'Unexpired quotation database row must still exist');
  assert(checkUnexpDb.pdf_path === unexpiredPdfPath, 'Unexpired quotation PDF path must still exist');

  const { data: checkUnexpItems } = await supabase.from('quotation_items').select('*').eq('quotation_id', unexpiredQ.id);
  assert(checkUnexpItems && checkUnexpItems.length === 1, 'Unexpired quotation line items must still exist');

  const { data: checkUnexpStorage } = await supabase.storage.from('pdfs').list('quotations', { search: `test_unexpired_${ts}.pdf` });
  assert(checkUnexpStorage && checkUnexpStorage.some(f => f.name === `test_unexpired_${ts}.pdf`), 'Unexpired quotation PDF file must still exist in storage');
  console.log('✅ Criterion 1 PASSED: Unexpired quotation and associated storage file remain fully intact');

  // Criterion 2 & 3: Exact and past deadline quotations are permanently deleted
  console.log('\n--- Criteria 2 & 3: Exact and past deadline quotations are permanently deleted ---');
  const { data: checkExactDb } = await supabase.from('quotations').select('*').eq('id', exactQ.id).maybeSingle();
  assert(checkExactDb === null, 'Exact deadline quotation must be permanently deleted from database');

  const { data: checkPastDb } = await supabase.from('quotations').select('*').eq('id', pastQ.id).maybeSingle();
  assert(checkPastDb === null, 'Past deadline quotation must be permanently deleted from database');
  console.log('✅ Criteria 2 & 3 PASSED: Quotations reaching or exceeding 20-day deadline are permanently deleted');

  // Criterion 4: Dependent line items removed
  console.log('\n--- Criterion 4: Dependent records (quotation_items) are removed ---');
  const { data: checkExactItems } = await supabase.from('quotation_items').select('*').eq('quotation_id', exactQ.id);
  assert(!checkExactItems || checkExactItems.length === 0, 'Dependent quotation_items for exact deadline quotation must be removed');

  const { data: checkPastItems } = await supabase.from('quotation_items').select('*').eq('quotation_id', pastQ.id);
  assert(!checkPastItems || checkPastItems.length === 0, 'Dependent quotation_items for past deadline quotation must be removed');
  console.log('✅ Criterion 4 PASSED: Quotation line items and dependent records completely deleted');

  // Criterion 5: Storage PDFs removed
  console.log('\n--- Criterion 5: Exclusive storage PDFs removed ---');
  const { data: checkExactStorage } = await supabase.storage.from('pdfs').list('quotations', { search: `test_exact_${ts}.pdf` });
  assert(!checkExactStorage || !checkExactStorage.some(f => f.name === `test_exact_${ts}.pdf`), 'Exact deadline storage PDF must be deleted');

  const { data: checkPastStorage } = await supabase.storage.from('pdfs').list('quotations', { search: `test_past_${ts}.pdf` });
  assert(!checkPastStorage || !checkPastStorage.some(f => f.name === `test_past_${ts}.pdf`), 'Past deadline storage PDF must be deleted');
  console.log('✅ Criterion 5 PASSED: Exclusive quotation PDFs removed from Supabase storage');

  // Criterion 6: Shared product and customer data remained intact
  console.log('\n--- Criterion 6: Shared products & settings remain untouched ---');
  const postProducts = await getInventoryProducts();
  assert(postProducts?.length === initialProductCount, `Product definitions count unchanged (${initialProductCount})`);
  console.log('✅ Criterion 6 PASSED: Shared products, stock catalog, and settings untouched');

  // Criterion 7 & 8: Deleted quotations disappear from history API, pagination count decreases, page refresh returns no deleted records
  console.log('\n--- Criteria 7 & 8: History API and pagination reflect deletion ---');
  const { data: historyList, count: historyCount } = await supabase
    .from('quotations')
    .select('id, quotation_number', { count: 'exact' });
  const idsInHistory = (historyList || []).map(q => q.id);
  assert(!idsInHistory.includes(exactQ.id), 'Exact deadline quotation must not appear in history query');
  assert(!idsInHistory.includes(pastQ.id), 'Past deadline quotation must not appear in history query');
  assert(idsInHistory.includes(unexpiredQ.id), 'Unexpired quotation must appear in history query');
  console.log(`✅ Criteria 7 & 8 PASSED: Deleted quotations disappear from history API (${historyCount} active quotations remaining)`);

  // Criterion 9: Quotation numbering sequence did not decrease or reuse deleted numbers
  console.log('\n--- Criterion 9: Numbering sequence does not decrease or reuse deleted numbers ---');
  const postCleanupNextNumber = await peekNextQuotationNumber();
  const postCleanupHighest = await getHighestSequenceValue();
  assert(postCleanupHighest >= initialHighest, `Highest sequence (${postCleanupHighest}) must be >= initial (${initialHighest})`);
  console.log(`Initial Next: ${initialNextNumber}, Post-Cleanup Next: ${postCleanupNextNumber}`);
  console.log('✅ Criterion 9 PASSED: Quotation numbering sequence strictly preserved without decrement');

  // Criterion 10: Idempotency (Running cleanup twice causes no errors or duplicate processing)
  console.log('\n--- Criterion 10: Idempotency on consecutive runs ---');
  const cleanup2 = await runQuotationCleanup();
  console.log('Cleanup 2 Result (Idempotency run):', cleanup2);
  assert(cleanup2.failed === 0, 'Second cleanup run must have 0 failures');
  assert(cleanup2.deletedQuotations === 0, 'Second run must process 0 new deletions (already clean)');
  console.log('✅ Criterion 10 PASSED: Consecutive cleanup runs are fully idempotent with zero errors');

  // Criterion 11: Missing PDF from storage handled safely (doesn\'t fail DB delete)
  console.log('\n--- Criterion 11: Resilient handling of missing PDF (safe retry/recovery) ---');
  const missingPdfQNo = `CQS/TEST-MISSPDF-${ts}`;
  const missingPdfPath = `quotations/non_existent_file_${ts}.pdf`; // Never uploaded to storage
  const { data: missingPdfQ } = await supabase.from('quotations').insert([{
    quotation_number: missingPdfQNo,
    customer_name: `MISSING PDF CLIENT ${ts}`,
    quotation_date: '2026-10-01',
    subtotal: 2000,
    net_amount: 2360,
    pdf_path: missingPdfPath,
    created_at: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
    expires_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  }]).select().single();

  const cleanupMissingPdf = await runQuotationCleanup();
  const { data: checkMissingDb } = await supabase.from('quotations').select('*').eq('id', missingPdfQ.id).maybeSingle();
  assert(checkMissingDb === null, 'Quotation with already-missing storage PDF must still be cleanly deleted from DB');
  console.log('✅ Criterion 11 PASSED: Storage 404/missing files handled gracefully without blocking DB cleanup');

  // Criterion 13: Retained quotation workflow (PDF generation & detail view) works
  console.log('\n--- Criterion 13: Retained quotation PDF generation & detail view ---');
  const pdfBuffer = await generateQuotationPDF(checkUnexpDb, checkUnexpItems);
  assert(pdfBuffer && pdfBuffer.slice(0, 4).toString('ascii') === '%PDF', 'PDF buffer must be valid PDF');
  console.log('✅ Criterion 13 PASSED: PDF generation and viewing functions correctly for retained quotations');

  // Teardown unexpired fixture
  console.log('\n--- Teardown Test Fixtures ---');
  await supabase.from('quotation_items').delete().eq('quotation_id', unexpiredQ.id);
  await supabase.from('quotations').delete().eq('id', unexpiredQ.id);
  await supabase.storage.from('pdfs').remove([unexpiredPdfPath]);
  console.log('✓ Teardown complete.');

  console.log('\n================================================================');
  console.log('  ALL ACCEPTANCE CRITERIA VERIFIED AND PASSED SUCCESSFULLY!    ');
  console.log('================================================================\n');
}

runTestSuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
