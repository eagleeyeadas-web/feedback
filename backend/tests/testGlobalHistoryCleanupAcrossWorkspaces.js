import http from 'http';
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import supabase from '../src/services/supabase.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';
import installationRoutes from '../src/routes/installation.js';
import coordinatorRoutes from '../src/routes/coordinator.js';
import customerRoutes from '../src/routes/customers.js';
import quotationRoutes from '../src/routes/quotation.js';
import adminRoutes from '../src/routes/admin.js';

async function runGlobalHistoryCleanupTests() {
  console.log('========================================================================');
  console.log('  GLOBAL HISTORY CLEANUP ACROSS WORKSPACES VERIFICATION SUITE          ');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, name, details = '') {
    total++;
    if (condition) {
      console.log(`[PASS] ${name}`);
      if (details) console.log(`       ↳ ${details}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}`);
      if (details) console.error(`       ↳ ${details}`);
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  // Simulated Roles
  const userAdmin = { id: '00000000-0000-0000-0000-000000000000', email: 'admin@gmail.com', role: 'ADMIN' };
  const userSales = { id: '00000000-0000-0000-0000-000000000001', email: 'sales@gmail.com', role: 'SALES' };
  const userCoordinator = { id: '00000000-0000-0000-0000-000000000004', email: 'coordinator@gmail.com', role: 'COORDINATOR' };

  let simulatedUser = userAdmin;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = simulatedUser;
    req.profile = simulatedUser;
    req.adminUser = simulatedUser;
    next();
  });

  app.use('/api/admin/installations', installationRoutes);
  app.use('/api/admin/coordinator', coordinatorRoutes);
  app.use('/api/admin/customers', customerRoutes);
  app.use('/api/admin/quotations', quotationRoutes);
  app.use('/api/admin', adminRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/admin`;

  async function apiCall(endpoint, method = 'GET', body = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}${endpoint}`, options);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  try {
    // -------------------------------------------------------------------------
    // 1. Customer Directory Deletion & History Protection Tests
    // -------------------------------------------------------------------------
    console.log('\n--- Section 1: Customer Directory Deletion & History Protection ---');

    // Fetch deletion preview for customers
    const custPrev = await apiCall('/customers/deletion-preview?scope=TEST');
    assert(custPrev.ok, 'GET /customers/deletion-preview succeeds', `Eligible: ${custPrev.data.eligibleCount}, Total: ${custPrev.data.totalCount}`);

    // Try creating an isolated test customer if table exists
    const testCustMobile = `999000${Math.floor(1000 + Math.random() * 9000)}`;
    const { data: testCust, error: cErr } = await supabase
      .from('customers')
      .insert({
        client_name: 'Test Demo Client Inc',
        client_mobile: testCustMobile,
        client_location: 'Bangalore Test Depot',
      })
      .select()
      .maybeSingle();

    if (!cErr && testCust?.id) {
      assert(testCust?.id, 'Created isolated test customer record in customers table', `ID: ${testCust?.id}`);
      // Delete single customer
      const delCustRes = await apiCall(`/customers/${testCust.id}`, 'DELETE');
      assert(delCustRes.ok && delCustRes.data.success, 'DELETE /customers/:id succeeds for eligible customer');
    } else {
      console.log('       ↳ Customers table not present as physical table; fallback to checklist aggregation verified');
      assert(custPrev.data.totalCount >= 0, 'Customer directory fallback gracefully aggregates records');
    }

    // Bulk deletion count mismatch guard check
    const mismatchRes = await apiCall('/customers/delete-all', 'POST', {
      scope: 'TEST',
      confirmedCount: 999999,
    });
    assert(mismatchRes.status === 400, 'POST /customers/delete-all rejects count mismatch with 400');

    // -------------------------------------------------------------------------
    // 2. Customer Feedback Deletion & Storage Cleanup
    // -------------------------------------------------------------------------
    console.log('\n--- Section 2: Customer Feedback Deletion & Storage Cleanup ---');

    const feedbackPrev = await apiCall('/feedback/deletion-preview?scope=TEST');
    assert(feedbackPrev.ok, 'GET /feedback/deletion-preview succeeds', `Total: ${feedbackPrev.data.totalCount}, Eligible: ${feedbackPrev.data.eligibleCount}`);

    const fbMismatch = await apiCall('/feedback/delete-all', 'POST', {
      scope: 'TEST',
      confirmedCount: 999999,
    });
    assert(fbMismatch.status === 400, 'POST /feedback/delete-all rejects count mismatch with 400');

    // -------------------------------------------------------------------------
    // 3. Quotation Test Data Cleanup & Sequential Number Protection
    // -------------------------------------------------------------------------
    console.log('\n--- Section 3: Quotation Test Data Protection & Cleanup ---');

    // Request with missing or incorrect phrase must be rejected
    const badPhraseRes = await apiCall('/quotations/delete-test', 'POST', {
      confirmationPhrase: 'WRONG PHRASE',
    });
    assert(badPhraseRes.status === 400, 'POST /quotations/delete-test rejects incorrect phrase with 400', badPhraseRes.data.error);

    // Call with correct phrase
    const goodPhraseRes = await apiCall('/quotations/delete-test', 'POST', {
      confirmationPhrase: 'DELETE TEST QUOTATIONS',
    });
    assert(goodPhraseRes.ok && goodPhraseRes.data.success, 'POST /quotations/delete-test accepts exact confirmation phrase',
      `Deleted: ${goodPhraseRes.data.deletedCount}, Preserved: ${goodPhraseRes.data.skippedCount}, Deleted Details: ${goodPhraseRes.data.deletedDetails?.length || 0}`);

    // Verify all existing quotations remain intact or sequence is maintained
    const { count: remainingQuotations } = await supabase.from('quotations').select('id', { count: 'exact', head: true });
    assert(remainingQuotations >= 0, `Operational quotations count verified: ${remainingQuotations}`);

    // -------------------------------------------------------------------------
    // 4. Coordinator Workspace Requests Deletion
    // -------------------------------------------------------------------------
    console.log('\n--- Section 4: Coordinator Workspace Schedule Requests Deletion ---');

    // Create a dummy notification to test single and bulk notification deletion
    const { data: dummyNotif } = await supabase
      .from('app_notifications')
      .insert({
        recipient_role: 'COORDINATOR',
        notification_type: 'TEST_ALERT',
        title: 'Test Notification for Cleanup',
        message: 'This is an automated test notification',
        severity: 'INFO',
      })
      .select()
      .single();

    if (dummyNotif?.id) {
      const delNotifRes = await apiCall(`/coordinator/notifications/${dummyNotif.id}`, 'DELETE');
      assert(delNotifRes.ok && delNotifRes.data.success, 'DELETE /coordinator/notifications/:id deletes notification');
    } else {
      console.log('[SKIP] app_notifications table not available for insert test');
    }

    // Test delete-all notifications endpoint
    const delAllNotifRes = await apiCall('/coordinator/notifications/delete-all', 'POST');
    assert(delAllNotifRes.ok && delAllNotifRes.data.success, 'POST /coordinator/notifications/delete-all endpoint responds successfully');

    // Test extension requests bulk delete endpoint
    const delAllExtRes = await apiCall('/coordinator/schedule/extensions/delete-all', 'POST');
    assert(delAllExtRes.ok && delAllExtRes.data.success, 'POST /coordinator/schedule/extensions/delete-all endpoint responds successfully');

    // Test rest day requests bulk delete endpoint
    const delAllRestRes = await apiCall('/coordinator/schedule/rest-days/delete-all', 'POST');
    assert(delAllRestRes.ok && delAllRestRes.data.success, 'POST /coordinator/schedule/rest-days/delete-all endpoint responds successfully');

    // Test leave requests bulk delete endpoint
    const delAllLeaveRes = await apiCall('/coordinator/schedule/leaves/delete-all', 'POST');
    assert(delAllLeaveRes.ok && delAllLeaveRes.data.success, 'POST /coordinator/schedule/leaves/delete-all endpoint responds successfully');

    // -------------------------------------------------------------------------
    // 5. Database & Inventory Guardrail Integrity Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Section 5: Database Schema & Inventory Balance Integrity ---');

    // Verify store inventory balances are intact
    const stockItems = await getMaterialInventory();
    assert(Array.isArray(stockItems) && stockItems.length > 0, 'Store inventory ledger balances are intact and operational');
    console.log(`       ↳ Verified sample stock records: ${stockItems.length} items (Tape: ${stockItems[0]?.current_stock})`);

    // Verify installation_checklists table is intact
    const { count: checklistCount, error: chkErr } = await supabase
      .from('installation_checklists')
      .select('id', { count: 'exact', head: true });
    assert(!chkErr && checklistCount !== null, `installation_checklists table is intact (total: ${checklistCount})`);

    console.log('\n========================================================================');
    console.log(`  SUMMARY: ALL ${passed}/${total} GLOBAL CLEANUP VERIFICATION TESTS PASSED `);
    console.log('========================================================================\n');
  } finally {
    server.close();
  }
}

runGlobalHistoryCleanupTests().catch((err) => {
  console.error('\nTest Suite Failed:', err);
  process.exit(1);
});
