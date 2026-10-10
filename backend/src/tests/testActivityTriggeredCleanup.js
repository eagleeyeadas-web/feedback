import supabase from '../services/supabase.js';
import {
  executeActivityTriggeredCleanup,
  claimCleanupLock,
  releaseCleanupLock,
  getCleanupState,
  handleCleanupEndpoint,
  _setCleanupStateForTesting,
  CLEANUP_JOB_ID,
  COOLDOWN_HOURS,
  RETENTION_DAYS,
} from '../services/quotationCleanupService.js';

import { getInventoryProducts } from '../services/inventoryService.js';

async function runActivityTriggeredCleanupTestSuite() {
  console.log('================================================================');
  console.log('  EAGLE EYE SAFDRIVE: USER-ACTIVITY 24H CLEANUP TEST SUITE      ');
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

  // ========================================================================
  // STEP 1: Verify Frontend 2-Minute Active Session Tracking Logic Simulation
  // ========================================================================
  console.log('--- Step 1: Frontend Active Session & Inactivity Pause Simulation ---');

  // Simulating the exact state machine implemented in ActiveSessionCleanupTracker.jsx
  function simulateSessionTracker({ totalSeconds, idleAfterSeconds, isHiddenDuring = [] }) {
    let accumulatedActiveSeconds = 0;
    let lastActivityTime = 0;
    let hasTriggered = false;
    const INACTIVITY_THRESHOLD_SECONDS = 30;
    const TARGET_ACTIVE_SECONDS = 120; // 2 minutes

    for (let sec = 1; sec <= totalSeconds; sec++) {
      const isHidden = isHiddenDuring.includes(sec);
      
      // User generates interaction before idle cutoff
      if (sec <= idleAfterSeconds) {
        lastActivityTime = sec;
      }

      if (isHidden) {
        // Tab is hidden in background; timer pauses
        continue;
      }

      const idleDuration = sec - lastActivityTime;
      if (idleDuration <= INACTIVITY_THRESHOLD_SECONDS) {
        accumulatedActiveSeconds++;
        if (accumulatedActiveSeconds >= TARGET_ACTIVE_SECONDS && !hasTriggered) {
          hasTriggered = true;
        }
      }
    }

    return { accumulatedActiveSeconds, hasTriggered };
  }

  // 1a. User leaves tab unattended: interaction stops at 10s, tab stays open for 300s (5 mins)
  const unattendedResult = simulateSessionTracker({ totalSeconds: 300, idleAfterSeconds: 10 });
  assert(!unattendedResult.hasTriggered, 'Unattended open tab pauses after 30s idle and does NOT trigger cleanup');
  assert(unattendedResult.accumulatedActiveSeconds === 40, `Unattended tab paused at 40s (got ${unattendedResult.accumulatedActiveSeconds}s)`);

  // 1b. User active for only 90s, then logs out/closes window
  const shortSessionResult = simulateSessionTracker({ totalSeconds: 90, idleAfterSeconds: 90 });
  assert(!shortSessionResult.hasTriggered, 'Session of 90 seconds (< 2 minutes) does NOT trigger cleanup');

  // 1c. User active for full 120 seconds (2 continuous minutes)
  const eligibleSessionResult = simulateSessionTracker({ totalSeconds: 125, idleAfterSeconds: 125 });
  assert(eligibleSessionResult.hasTriggered, 'Continuous active session reaches 120s (2 mins) and TRIGGERS cleanup');

  // 1d. User tab hidden in background for 60 seconds
  const hiddenTabResult = simulateSessionTracker({
    totalSeconds: 150,
    idleAfterSeconds: 150,
    isHiddenDuring: Array.from({ length: 60 }, (_, i) => i + 10), // hidden from sec 10 to 69
  });
  assert(hiddenTabResult.accumulatedActiveSeconds === 90, 'Hidden tab in background paused active accumulation');
  assert(!hiddenTabResult.hasTriggered, 'Active time remained below 120s due to background pause');

  // ========================================================================
  // STEP 2: Stock & Inventory Pre-Cleanup Snapshot
  // ========================================================================
  console.log('\n--- Step 2: Snapshot Stock & Inventory Ledgers ---');
  const initialProducts = await getInventoryProducts();
  const initialCount = initialProducts?.length || 0;
  assert(initialCount > 0, `Inventory products accessible (${initialCount} items tracked)`);

  // ========================================================================
  // STEP 3: Database State & 24-Hour Cooldown Verification
  // ========================================================================
  console.log('\n--- Step 3: Test 24-Hour Cooldown and Persistent Database State ---');

  // 3a. Force reset state to allow initial test run
  await releaseCleanupLock({
    success: true,
    summary: { note: 'Initial test setup' },
    error: null,
  });

  // Manually set last_successful_run_at to 25 hours ago to simulate due cleanup
  const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  _setCleanupStateForTesting({
    last_successful_run_at: twentyFiveHoursAgo,
    last_run_status: 'COMPLETED',
    locked_until: null,
  });
  try {
    await supabase.from('system_cleanup_state').update({
      last_successful_run_at: twentyFiveHoursAgo,
      last_run_status: 'COMPLETED',
      locked_until: null,
    }).eq('id', CLEANUP_JOB_ID);
  } catch (e) {
    // Table update fallback handled gracefully
  }

  // 3b. Execute cleanup when 25 hours have elapsed
  console.log('  Executing activity cleanup when > 24 hours elapsed...');
  const run1 = await executeActivityTriggeredCleanup({ userId: 'test-user-001', force: false });
  assert(run1.status === 'completed', `Cleanup executed successfully when 25h elapsed (status: ${run1.status})`);
  assert(run1.executed === true, 'Execution flag confirmed true');
  assert(Boolean(run1.lastSuccessfulRunAt), 'Last successful run timestamp was saved');

  // 3c. Verify state is persistent in database
  const stateCheck1 = await getCleanupState();
  assert(Boolean(stateCheck1.last_successful_run_at), `State persisted in database (timestamp: ${stateCheck1.last_successful_run_at})`);

  // 3d. Immediate subsequent request (0 minutes elapsed since last run)
  console.log('  Executing subsequent activity cleanup immediately after...');
  const run2 = await executeActivityTriggeredCleanup({ userId: 'test-user-002', force: false });
  assert(run2.status === 'skipped', `Cleanup correctly SKIPPED within 24 hours (status: ${run2.status})`);
  assert(run2.executed === false, 'Execution flag confirmed false on skipped run');
  assert(run2.reason === 'COOLDOWN_ACTIVE', `Skip reason is COOLDOWN_ACTIVE (got: ${run2.reason})`);

  // ========================================================================
  // STEP 4: Concurrency & Atomic Claim Locking
  // ========================================================================
  console.log('\n--- Step 4: Concurrency Lock & Race-Condition Defense ---');

  // Temporarily reset last_successful_run_at to simulate due cleanup
  _setCleanupStateForTesting({
    last_successful_run_at: twentyFiveHoursAgo,
    last_run_status: 'IDLE',
    locked_until: null,
  });
  try {
    await supabase.from('system_cleanup_state').update({
      last_successful_run_at: twentyFiveHoursAgo,
      last_run_status: 'IDLE',
      locked_until: null,
    }).eq('id', CLEANUP_JOB_ID);
  } catch (e) {}

  // Simulate 5 simultaneous requests from concurrent users/tabs at the exact same millisecond
  console.log('  Dispatching 5 simultaneous claim requests in parallel...');
  const claims = await Promise.all([
    claimCleanupLock({ userId: 'tab-1', cooldownHours: 24 }),
    claimCleanupLock({ userId: 'tab-2', cooldownHours: 24 }),
    claimCleanupLock({ userId: 'tab-3', cooldownHours: 24 }),
    claimCleanupLock({ userId: 'tab-4', cooldownHours: 24 }),
    claimCleanupLock({ userId: 'tab-5', cooldownHours: 24 }),
  ]);

  const claimedCount = claims.filter(c => c.claimed).length;
  const rejectedCount = claims.filter(c => !c.claimed).length;

  console.log(`  Parallel results: Claimed=${claimedCount}, Rejected/Skipped=${rejectedCount}`);
  assert(claimedCount === 1, `EXACTLY ONE request acquired the lock (claimed: ${claimedCount})`);
  assert(rejectedCount === 4, `The other 4 requests were safely blocked/skipped (rejected: ${rejectedCount})`);

  // Release the acquired lock
  await releaseCleanupLock({ success: true, summary: { test: 'concurrency' } });

  // ========================================================================
  // STEP 5: Failure Handling & Retry Retention
  // ========================================================================
  console.log('\n--- Step 5: Failure Handling & Timestamp Preservation ---');

  const beforeFailureState = await getCleanupState();
  const originalSuccessTimestamp = beforeFailureState.last_successful_run_at;

  // Simulate a failure release
  await releaseCleanupLock({
    success: false,
    error: 'Simulated network failure on storage deletion',
  });

  const afterFailureState = await getCleanupState();
  assert(afterFailureState.last_run_status === 'FAILED', 'Status updated to FAILED');
  assert(
    afterFailureState.last_successful_run_at === originalSuccessTimestamp,
    'Failed cleanup DID NOT overwrite last_successful_run_at timestamp (Rule 8)'
  );
  assert(afterFailureState.locked_until === null, 'Lock was released to allow subsequent retry (Rule 8)');

  // ========================================================================
  // STEP 6: Verify 20-Day Storage Deletion with DB Record Preservation
  // ========================================================================
  console.log('\n--- Step 6: 20-Day Retention & Business Record Preservation ---');
  const timestamp = Date.now();
  const testQuotationNoExpired = `CQS/ACT-EXP-${timestamp}`;
  const testQuotationNoActive = `CQS/ACT-ACT-${timestamp}`;

  const dummyPdf = Buffer.from('%PDF-1.4 User Activity Trigger Retention Verification');
  const expiredPdfPath = `quotations/test_act_expired_${timestamp}.pdf`;
  const activePdfPath = `quotations/test_act_active_${timestamp}.pdf`;

  // Upload test files
  await supabase.storage.from('pdfs').upload(expiredPdfPath, dummyPdf, { contentType: 'application/pdf', upsert: true });
  await supabase.storage.from('pdfs').upload(activePdfPath, dummyPdf, { contentType: 'application/pdf', upsert: true });

  // Insert expired quotation (> 20 days old)
  const { data: expQuotation } = await supabase.from('quotations').insert([{
    quotation_number: testQuotationNoExpired,
    customer_name: 'TEST ACTIVITY CLIENT',
    quotation_date: '2026-10-10',
    subtotal: 4000,
    net_amount: 4720,
    pdf_path: expiredPdfPath,
    created_at: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString(),
    expires_at: new Date(Date.now() - 3600 * 1000).toISOString(),
  }]).select().single();

  // Insert quotation items to test business record retention
  await supabase.from('quotation_items').insert([
    { quotation_id: expQuotation.id, sno: 1, item_description: 'Test MDVR GPS Camera', qty: 1, rate: 4000, amount: 4000 }
  ]);

  // Insert active quotation (< 20 days old)
  const { data: actQuotation } = await supabase.from('quotations').insert([{
    quotation_number: testQuotationNoActive,
    customer_name: 'TEST ACTIVE CLIENT',
    quotation_date: '2026-10-10',
    subtotal: 2000,
    net_amount: 2360,
    pdf_path: activePdfPath,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 19 * 24 * 60 * 60 * 1000).toISOString(),
  }]).select().single();

  // Run cleanup with force=true to bypass cooldown for retention verification
  const forceResult = await executeActivityTriggeredCleanup({ userId: 'test-admin', force: true });
  assert(forceResult.status === 'completed', 'Forced cleanup completed');

  // Verify expired PDF deleted from storage
  const { data: storageExpired } = await supabase.storage.from('pdfs').list('quotations', { search: `test_act_expired_${timestamp}.pdf` });
  const expiredPdfStillInStorage = storageExpired && storageExpired.some(f => f.name === `test_act_expired_${timestamp}.pdf`);
  assert(!expiredPdfStillInStorage, 'Expired physical PDF (> 20 days) was deleted from storage');

  // Verify expired DB record PRESERVED with pdf_path = null
  const { data: expDbCheck } = await supabase.from('quotations').select('id, quotation_number, pdf_path').eq('id', expQuotation.id).single();
  assert(expDbCheck !== null, 'Expired quotation database record was PRESERVED');
  assert(expDbCheck.pdf_path === null, 'Expired quotation pdf_path was updated to null');

  // Verify quotation items PRESERVED
  const { data: itemsCheck } = await supabase.from('quotation_items').select('id').eq('quotation_id', expQuotation.id);
  assert(itemsCheck && itemsCheck.length === 1, 'Quotation line items preserved and intact');

  // Verify active quotation (< 20 days) PRESERVED in storage
  const { data: storageActive } = await supabase.storage.from('pdfs').list('quotations', { search: `test_act_active_${timestamp}.pdf` });
  const activePdfInStorage = storageActive && storageActive.some(f => f.name === `test_act_active_${timestamp}.pdf`);
  assert(activePdfInStorage, 'Active quotation PDF (< 20 days) was preserved in storage');

  // ========================================================================
  // STEP 7: Verify Stock & Inventory Remained 100% Intact
  // ========================================================================
  console.log('\n--- Step 7: Verify Stock & Inventory Protection ---');
  const postProducts = await getInventoryProducts();
  assert(postProducts?.length === initialCount, `Inventory product count unchanged (${initialCount})`);

  let balancesMatch = true;
  for (const initP of initialProducts) {
    const match = postProducts.find(p => p.id === initP.id);
    if (!match || match.usable_stock !== initP.usable_stock) {
      balancesMatch = false;
      break;
    }
  }
  assert(balancesMatch, 'All stock quantities and inventory balances remain 100% identical');

  // ========================================================================
  // STEP 8: Teardown Test Records
  // ========================================================================
  console.log('\n--- Step 8: Teardown Test Fixtures ---');
  await supabase.from('quotation_items').delete().eq('quotation_id', expQuotation.id);
  await supabase.from('quotations').delete().eq('id', expQuotation.id);
  await supabase.from('quotations').delete().eq('id', actQuotation.id);
  await supabase.storage.from('pdfs').remove([activePdfPath]);
  console.log('  Cleaned up test fixture records and storage files.');

  console.log('\n================================================================');
  console.log(`  SUMMARY: ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY! `);
  console.log('================================================================\n');
}

runActivityTriggeredCleanupTestSuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILED WITH ERROR:', err);
  process.exit(1);
});
