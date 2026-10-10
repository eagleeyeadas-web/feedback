import supabase from '../services/supabase.js';
import { runFullCleanup, handleCleanupEndpoint, RETENTION_DAYS } from '../services/quotationCleanupService.js';
import { getInventoryProducts } from '../services/inventoryService.js';

async function runCentralized20DayCleanupTestSuite() {
  console.log('================================================================');
  console.log('  EAGLE EYE SAFDRIVE: 20-DAY CENTRALIZED CLEANUP TEST SUITE     ');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS [Test ${totalTests}]: ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL [Test ${totalTests}]: ${message}`);
      throw new Error(`Test assertion failed: ${message}`);
    }
  }

  // --- TEST 1: Retention Policy Constant ---
  console.log('--- Step 1: Verify 20-Day Retention Configuration ---');
  assert(RETENTION_DAYS === 20, `Retention policy constant is exactly 20 days (found: ${RETENTION_DAYS})`);

  // --- TEST 2: Stock & Inventory Pre-Cleanup Snapshot ---
  console.log('\n--- Step 2: Snapshot Stock & Inventory Ledgers ---');
  const initialProducts = await getInventoryProducts();
  const initialProdCount = initialProducts?.length || 0;

  console.log(`  Initial stock items tracked: ${initialProdCount}`);
  assert(initialProdCount > 0, `Inventory products accessible (${initialProdCount} items tracked)`);


  // --- Step 3: Setup Test Quotations (Expired vs Unexpired) ---
  console.log('\n--- Step 3: Setup Expired vs Active Test Quotations & Storage Files ---');
  const timestamp = Date.now();
  const testQuotationNoExpired = `CQS/TEST-EXP-${timestamp}`;
  const testQuotationNoActive = `CQS/TEST-ACT-${timestamp}`;

  const dummyPdfContent = Buffer.from('%PDF-1.4 Test PDF Content for Eagle Eye Retention Verification');
  const expiredPdfPath = `quotations/test_expired_${timestamp}.pdf`;
  const activePdfPath = `quotations/test_active_${timestamp}.pdf`;

  // Upload dummy files to storage
  const { error: expUploadErr } = await supabase.storage.from('pdfs').upload(expiredPdfPath, dummyPdfContent, {
    contentType: 'application/pdf',
    upsert: true,
  });
  assert(!expUploadErr, `Uploaded expired test PDF to storage (${expiredPdfPath})`);

  const { error: actUploadErr } = await supabase.storage.from('pdfs').upload(activePdfPath, dummyPdfContent, {
    contentType: 'application/pdf',
    upsert: true,
  });
  assert(!actUploadErr, `Uploaded active test PDF to storage (${activePdfPath})`);

  // Insert expired quotation (expired 1 hour ago)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: expiredQuotation, error: expInsertErr } = await supabase.from('quotations').insert([{
    quotation_number: testQuotationNoExpired,
    customer_name: 'TEST EXPIRED CUSTOMER LTD',
    quotation_date: '2026-10-10',
    subtotal: 5000,
    net_amount: 5900,
    pdf_path: expiredPdfPath,
    created_at: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(), // 21 days ago
    expires_at: oneHourAgo,
  }]).select().single();
  assert(!expInsertErr && expiredQuotation?.id, `Inserted test expired quotation (ID: ${expiredQuotation?.id})`);

  // Insert line items for expired quotation to test cascade safety
  const { data: expiredItems, error: itemsInsertErr } = await supabase.from('quotation_items').insert([
    { quotation_id: expiredQuotation.id, sno: 1, item_description: 'SafDrive GPS Unit', qty: 1, rate: 5000, amount: 5000 }
  ]).select();
  assert(!itemsInsertErr && expiredItems?.length > 0, 'Inserted line items for expired quotation');

  // Insert active quotation (expires in 19 days)
  const nineteenDaysLater = new Date(Date.now() + 19 * 24 * 60 * 60 * 1000).toISOString();
  const { data: activeQuotation, error: actInsertErr } = await supabase.from('quotations').insert([{
    quotation_number: testQuotationNoActive,
    customer_name: 'TEST ACTIVE CUSTOMER LTD',
    quotation_date: '2026-10-10',
    subtotal: 3000,
    net_amount: 3540,
    pdf_path: activePdfPath,
    created_at: new Date().toISOString(),
    expires_at: nineteenDaysLater,
  }]).select().single();
  assert(!actInsertErr && activeQuotation?.id, `Inserted test active quotation (ID: ${activeQuotation?.id})`);

  // --- Step 4: Execute Full Centralized Cleanup Job ---
  console.log('\n--- Step 4: Execute Centralized 20-Day Cleanup ---');
  const cleanupResult = await runFullCleanup();
  console.log('  Cleanup summary:', JSON.stringify({
    policy: cleanupResult.policy,
    retentionDays: cleanupResult.retentionDays,
    quotationsProcessed: cleanupResult.modules.quotations.processed,
    quotationPdfsDeleted: cleanupResult.modules.quotations.deletedFiles,
    excludedModulesCount: cleanupResult.excludedModules.length,
  }, null, 2));

  assert(cleanupResult.retentionDays === 20, 'Cleanup engine confirmed 20-day policy');
  assert(cleanupResult.modules.quotations.dbRecordsPreserved === true, 'Database preservation flag confirmed true');

  // --- Step 5: Verify Storage Object Deletion & DB Record Preservation ---
  console.log('\n--- Step 5: Verify Storage and Database Integrity ---');

  // Check Expired PDF in Storage (MUST BE GONE)
  const { data: storageListExpired } = await supabase.storage.from('pdfs').list('quotations', {
    search: `test_expired_${timestamp}.pdf`,
  });
  const expiredPdfStillInStorage = storageListExpired && storageListExpired.some(f => f.name === `test_expired_${timestamp}.pdf`);
  assert(!expiredPdfStillInStorage, 'Physical expired PDF was deleted from Supabase Storage');

  // Check Expired DB Record (MUST STILL EXIST with pdf_path = null)
  const { data: expiredDbCheck } = await supabase.from('quotations').select('id, quotation_number, pdf_path').eq('id', expiredQuotation.id).single();
  assert(expiredDbCheck !== null, 'Expired quotation database record was PRESERVED (not deleted)');
  assert(expiredDbCheck.pdf_path === null, 'Expired quotation pdf_path was updated to null');

  // Check Expired Line Items (MUST STILL EXIST)
  const { data: itemsDbCheck } = await supabase.from('quotation_items').select('id').eq('quotation_id', expiredQuotation.id);
  assert(itemsDbCheck && itemsDbCheck.length === 1, 'Expired quotation line items are completely intact');

  // Check Active Quotation PDF in Storage (MUST STILL EXIST)
  const { data: storageListActive } = await supabase.storage.from('pdfs').list('quotations', {
    search: `test_active_${timestamp}.pdf`,
  });
  const activePdfInStorage = storageListActive && storageListActive.some(f => f.name === `test_active_${timestamp}.pdf`);
  assert(activePdfInStorage, 'Active quotation PDF (< 20 days) was PRESERVED in Supabase Storage');

  // Check Active DB Record (MUST STILL HAVE pdf_path)
  const { data: activeDbCheck } = await supabase.from('quotations').select('id, quotation_number, pdf_path').eq('id', activeQuotation.id).single();
  assert(activeDbCheck && activeDbCheck.pdf_path === activePdfPath, 'Active quotation database record and pdf_path remain untouched');

  // --- Step 6: Verify Stock & Inventory Was Completely Untouched ---
  console.log('\n--- Step 6: Verify Strict Stock & Inventory Exclusion ---');
  const postProducts = await getInventoryProducts();

  assert(postProducts?.length === initialProdCount, `Inventory products count unchanged (${initialProdCount})`);

  // Verify stock quantities did not change
  let balancesMatch = true;
  if (initialProducts && postProducts) {
    for (const initP of initialProducts) {
      const match = postProducts.find(p => p.id === initP.id);
      if (!match || match.usable_stock !== initP.usable_stock) {
        balancesMatch = false;
        break;
      }
    }
  }
  assert(balancesMatch, 'All stock quantities and inventory balances remain 100% identical');

  // --- Step 7: Verify CRON_SECRET Endpoint Security & Fallback Prohibition ---
  console.log('\n--- Step 7: Verify Endpoint Authentication & CRON_SECRET ---');
  const mockRes = () => {
    const res = {};
    res.statusCode = 200;
    res.data = null;
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (obj) => {
      res.data = obj;
      return res;
    };
    return res;
  };

  // Test 7a: Missing secret / no auth -> 401 Unauthorized
  const resNoAuth = mockRes();
  await handleCleanupEndpoint({ headers: {}, query: {} }, resNoAuth);
  assert(resNoAuth.statusCode === 401, `Unauthorized request rejected with status 401 (got ${resNoAuth.statusCode})`);

  // Test 7b: Wrong secret -> 401 Unauthorized
  const resWrongSecret = mockRes();
  await handleCleanupEndpoint({ headers: { 'x-cron-secret': 'wrong_secret_12345' }, query: {} }, resWrongSecret);
  assert(resWrongSecret.statusCode === 401, `Invalid secret rejected with status 401 (got ${resWrongSecret.statusCode})`);

  // Test 7c: Correct CRON_SECRET -> 200 Success
  const resValidSecret = mockRes();
  await handleCleanupEndpoint({ headers: { 'x-cron-secret': process.env.CRON_SECRET }, query: {} }, resValidSecret);
  assert(resValidSecret.statusCode === 200, `Authorized CRON_SECRET accepted with status 200 (got ${resValidSecret.statusCode})`);
  assert(resValidSecret.data?.result?.policy === '20-Day Centralized Automatic Retention', 'Endpoint returned 20-day policy confirmation');

  // --- Step 8: Idempotency & Repeatability ---
  console.log('\n--- Step 8: Verify Idempotency on Repeated Execution ---');
  const repeatedResult = await runFullCleanup();
  assert(repeatedResult.success === true, 'Repeated cleanup run completed cleanly with zero errors');

  // --- Cleanup Test Artifacts from Database & Storage ---
  console.log('\n--- Step 9: Teardown Test Fixtures ---');
  await supabase.from('quotation_items').delete().eq('quotation_id', expiredQuotation.id);
  await supabase.from('quotations').delete().eq('id', expiredQuotation.id);
  await supabase.from('quotations').delete().eq('id', activeQuotation.id);
  await supabase.storage.from('pdfs').remove([activePdfPath]);
  console.log('  Cleaned up test fixture database rows and active storage file.');

  console.log('\n================================================================');
  console.log(`  SUMMARY: ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY! `);
  console.log('================================================================\n');
}

runCentralized20DayCleanupTestSuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILED WITH ERROR:', err);
  process.exit(1);
});
