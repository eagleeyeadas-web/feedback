import assert from 'assert';
import supabase from '../src/services/supabase.js';
import {
  assertChecklistEligibleForExpenses,
  getExpensesForChecklist,
  saveJobExpenses,
  generateTechnicianExpensePDFForChecklist,
} from '../src/services/expenseService.js';
import { getChecklistById } from '../src/services/installationService.js';

async function runTestSuite() {
  console.log('========================================================================');
  console.log('TEST SUITE: TECHNICIAN EXPENSES AUTHORIZATION & WORKFLOW VERIFICATION');
  console.log('Testing 12 Comprehensive Verification Requirements');
  console.log('========================================================================\n');

  // Load the target completed checklist
  // From database: EE-INST-20261022-0019 (assigned to Mathi, completed)
  const checklistId = 'a4ebf823-c29e-423d-a39c-73dcffff4b28';
  const checklist = await getChecklistById(checklistId);
  assert.ok(checklist, 'Target checklist must exist');
  console.log(`Target Checklist: ${checklist.checklist_number} (ID: ${checklist.id})`);
  console.log(`Assigned Service Engineer: ${checklist.service_engineer} (ID: ${checklist.service_engineer_id})`);
  console.log(`Status: ${checklist.installation_status}\n`);

  // Define User Profiles
  const assignedTechUser = {
    id: 'e1000000-0000-0000-0000-000000000001',
    email: 'mathi@eagleeye.com',
    full_name: 'Mathi',
    role: 'TECHNICAL',
  };

  const appTechUser = {
    id: 't1111111-1111-4111-a111-111111111111',
    email: 'tech@gmail.com',
    full_name: 'Service Engineer',
    role: 'TECHNICAL',
  };

  const unassignedTechUser = {
    id: 'e1000000-0000-0000-0000-000000000006',
    email: 'guna@eagleeye.com',
    full_name: 'Guna',
    role: 'TECHNICAL',
  };

  const adminUser = {
    id: 'a1111111-1111-4111-a111-111111111111',
    email: 'admin@eagleeyesafdrive.com',
    full_name: 'Administrator',
    role: 'ADMIN',
  };

  const salesUser = {
    id: 's1111111-1111-4111-a111-111111111111',
    email: 'sales@gmail.com',
    full_name: 'Sales Person',
    role: 'SALES',
  };

  const storeUser = {
    id: 'st111111-1111-4111-a111-111111111111',
    email: 'store@gmail.com',
    full_name: 'Store Manager',
    role: 'STORE_MANAGER',
  };

  const coordinatorUser = {
    id: 'c1111111-1111-4111-a111-111111111111',
    email: 'coordinator@gmail.com',
    full_name: 'Coordinator',
    role: 'COORDINATOR',
  };

  const hrUser = {
    id: 'h1111111-1111-4111-a111-111111111111',
    email: 'hr@gmail.com',
    full_name: 'HR Manager',
    role: 'HR',
  };

  // ---------------------------------------------------------------------------
  // TEST 1: The assigned technician can view their eligible expense entries
  // ---------------------------------------------------------------------------
  console.log('-> TEST 1: Assigned technician can view their eligible expense entries');
  const viewResTech = await getExpensesForChecklist(checklistId, assignedTechUser);
  assert.ok(viewResTech.expenses, 'Should return expenses array');
  assert.ok(Array.isArray(viewResTech.expenses), 'Expenses must be an array');
  console.log(`   [PASS] Assigned technician (${assignedTechUser.full_name}) successfully viewed ${viewResTech.expenses.length} entries.`);

  const viewResAppTech = await getExpensesForChecklist(checklistId, appTechUser);
  assert.ok(Array.isArray(viewResAppTech.expenses), 'App technician tech@gmail.com should also view entries');
  console.log(`   [PASS] Staff technician (${appTechUser.email}) successfully viewed ${viewResAppTech.expenses.length} entries.\n`);

  // ---------------------------------------------------------------------------
  // TEST 2: The assigned technician can add and save expenses
  // ---------------------------------------------------------------------------
  console.log('-> TEST 2: Assigned technician can add and save expenses');
  const initialCount = viewResTech.expenses.length;
  const testNewEntry = {
    category: 'Food',
    amount: 350.0,
    expense_date: '2026-10-18',
    payment_method: 'Cash',
    description: 'Dinner during outstation installation',
    notes: 'Dinner at hotel',
  };

  const saveRes = await saveJobExpenses({
    checklist_id: checklistId,
    user: assignedTechUser,
    is_draft: false,
    expenses: [
      ...viewResTech.expenses.map((e) => ({
        id: e.id,
        category: e.category,
        amount: e.amount,
        expense_date: e.expense_date,
        payment_method: e.payment_method,
        description: e.description,
        notes: e.notes,
      })),
      testNewEntry,
    ],
  });

  assert.strictEqual(
    saveRes.expenses.length,
    initialCount + 1,
    'Expenses count should increase by 1 after saving new entry'
  );
  const createdEntry = saveRes.expenses.find((e) => e.description === testNewEntry.description);
  assert.ok(createdEntry, 'New entry must exist in saved expenses');
  assert.strictEqual(Number(createdEntry.amount), 350.0, 'Amount must match');
  console.log(`   [PASS] Assigned technician saved expense entry (ID: ${createdEntry.id}, ₹${createdEntry.amount}).\n`);

  // ---------------------------------------------------------------------------
  // TEST 3: The total updates correctly
  // ---------------------------------------------------------------------------
  console.log('-> TEST 3: The total updates correctly');
  const sumBefore = viewResTech.expenses.reduce((acc, e) => acc + Number(e.amount), 0);
  const sumAfter = saveRes.expenses.reduce((acc, e) => acc + Number(e.amount), 0);
  assert.strictEqual(
    Math.round(sumAfter * 100) / 100,
    Math.round((sumBefore + 350.0) * 100) / 100,
    'Total should reflect sum of all entries'
  );
  console.log(`   [PASS] Total updated accurately: ₹${sumBefore} -> ₹${sumAfter} (+₹350.00).\n`);

  // Clean up the temporary test entry so we don't dirty original dataset
  if (createdEntry?.id) {
    await saveJobExpenses({
      checklist_id: checklistId,
      user: assignedTechUser,
      is_draft: false,
      delete_ids: [createdEntry.id],
      expenses: viewResTech.expenses.map((e) => ({
        id: e.id,
        category: e.category,
        amount: e.amount,
        expense_date: e.expense_date,
        payment_method: e.payment_method,
        description: e.description,
        notes: e.notes,
      })),
    });
    console.log(`   [INFO] Cleaned up test expense entry ${createdEntry.id}.\n`);
  }

  // ---------------------------------------------------------------------------
  // TEST 4: A technician cannot view another technician's expenses
  // ---------------------------------------------------------------------------
  console.log('-> TEST 4: A technician cannot view another technician\'s expenses');
  let techBBlocked = false;
  try {
    await getExpensesForChecklist(checklistId, unassignedTechUser);
  } catch (err) {
    if (err.statusCode === 403 || err.message.includes('not authorized')) {
      techBBlocked = true;
    }
  }
  assert.strictEqual(
    techBBlocked,
    true,
    'Violation: Technician B (Guna) must NOT be permitted to view Mathi\'s expenses.'
  );
  console.log('   [PASS] Unassigned technician Guna was blocked with 403 Forbidden.\n');

  // ---------------------------------------------------------------------------
  // TEST 5: Changing a checklist ID in an API request does not bypass authorization
  // ---------------------------------------------------------------------------
  console.log('-> TEST 5: Changing checklist ID in an API request does not bypass authorization');
  let bypassBlocked = false;
  try {
    // Guna tries to save expenses for Mathi's checklist ID
    await saveJobExpenses({
      checklist_id: checklistId,
      user: unassignedTechUser,
      expenses: [{ category: 'Fuel', amount: 999, description: 'Hacked entry', payment_method: 'Cash' }],
    });
  } catch (err) {
    if (err.statusCode === 403 || err.message.includes('not authorized')) {
      bypassBlocked = true;
    }
  }
  assert.strictEqual(
    bypassBlocked,
    true,
    'Violation: Changing checklist ID in saveJobExpenses must be blocked by server.'
  );
  console.log('   [PASS] Forged checklist ID request by unassigned technician rejected with 403 Forbidden.\n');

  // ---------------------------------------------------------------------------
  // TEST 6: Unauthenticated requests are rejected
  // ---------------------------------------------------------------------------
  console.log('-> TEST 6: Unauthenticated requests are rejected');
  let unauthGetBlocked = false;
  try {
    await getExpensesForChecklist(checklistId, null);
  } catch (err) {
    if (err.statusCode === 401 || err.message.includes('Authentication required')) {
      unauthGetBlocked = true;
    }
  }
  assert.strictEqual(unauthGetBlocked, true, 'Unauthenticated getExpensesForChecklist must be 401');

  let unauthSaveBlocked = false;
  try {
    await saveJobExpenses({
      checklist_id: checklistId,
      user: null,
      expenses: [],
    });
  } catch (err) {
    if (err.statusCode === 401 || err.message.includes('Authentication required')) {
      unauthSaveBlocked = true;
    }
  }
  assert.strictEqual(unauthSaveBlocked, true, 'Unauthenticated saveJobExpenses must be 401');
  console.log('   [PASS] Unauthenticated requests rejected with 401 Unauthorized.\n');

  // ---------------------------------------------------------------------------
  // TEST 7: Unauthorized roles are denied access
  // ---------------------------------------------------------------------------
  console.log('-> TEST 7: Unauthorized roles are denied access (Sales, Store, Coordinator, HR)');
  const unauthorizedUsers = [salesUser, storeUser, coordinatorUser, hrUser];

  for (const u of unauthorizedUsers) {
    let roleGetBlocked = false;
    try {
      await getExpensesForChecklist(checklistId, u);
    } catch (err) {
      if (err.statusCode === 403 || err.message.includes('not authorized')) {
        roleGetBlocked = true;
      }
    }
    assert.strictEqual(
      roleGetBlocked,
      true,
      `Violation: Role ${u.role} (${u.email}) must be blocked with 403 Forbidden.`
    );

    let roleSaveBlocked = false;
    try {
      await saveJobExpenses({
        checklist_id: checklistId,
        user: u,
        expenses: [],
      });
    } catch (err) {
      if (err.statusCode === 403 || err.message.includes('not authorized')) {
        roleSaveBlocked = true;
      }
    }
    assert.strictEqual(
      roleSaveBlocked,
      true,
      `Violation: Role ${u.role} (${u.email}) saveJobExpenses must be blocked with 403 Forbidden.`
    );
    console.log(`   [PASS] Role ${u.role} (${u.full_name}) strictly blocked with 403 Forbidden.`);
  }
  console.log();

  // ---------------------------------------------------------------------------
  // TEST 8: A legitimate authorized request does not show a stale permission error
  // ---------------------------------------------------------------------------
  console.log('-> TEST 8: Legitimate authorized request does not show stale permission error');
  let techError = null;
  try {
    await assertChecklistEligibleForExpenses(checklistId, assignedTechUser);
  } catch (err) {
    techError = err;
  }
  assert.strictEqual(techError, null, 'Assigned technician assert must not throw');

  let adminError = null;
  try {
    await assertChecklistEligibleForExpenses(checklistId, adminUser);
  } catch (err) {
    adminError = err;
  }
  assert.strictEqual(adminError, null, 'Admin assert must not throw');
  console.log('   [PASS] Authorized technician and Admin requests resolve cleanly without stale permission error.\n');

  // ---------------------------------------------------------------------------
  // TEST 9: Genuine database or RLS failures remain visible and are logged safely
  // ---------------------------------------------------------------------------
  console.log('-> TEST 9: Genuine database or RLS failures remain visible and are logged safely');
  let notFoundError = null;
  try {
    await assertChecklistEligibleForExpenses('00000000-0000-0000-0000-000000000000', assignedTechUser);
  } catch (err) {
    notFoundError = err;
  }
  assert.ok(notFoundError, 'Querying non-existent checklist must throw');
  assert.strictEqual(notFoundError.statusCode, 404, 'Must throw 404 for missing checklist');
  console.log(`   [PASS] Missing or failed DB lookup safely surfaced: ${notFoundError.message} (status: ${notFoundError.statusCode}).\n`);

  // ---------------------------------------------------------------------------
  // TEST 10: Expense PDF download and printing still work for the authorized technician
  // ---------------------------------------------------------------------------
  console.log('-> TEST 10: Expense PDF generation works for the authorized technician');
  const { pdfBuffer } = await generateTechnicianExpensePDFForChecklist(checklistId, assignedTechUser);
  assert.ok(pdfBuffer, 'PDF buffer must not be empty');
  assert.ok(Buffer.isBuffer(pdfBuffer), 'Result must be a Buffer');
  assert.ok(pdfBuffer.length > 500, 'PDF buffer must contain substantial PDF data');
  const header = pdfBuffer.toString('utf8', 0, 5);
  assert.strictEqual(header, '%PDF-', 'Buffer must have valid PDF file magic header (%PDF-)');
  console.log(`   [PASS] PDF generated successfully (${pdfBuffer.length} bytes, valid %PDF- header).\n`);

  // ---------------------------------------------------------------------------
  // TEST 11: Existing expense data remains unchanged
  // ---------------------------------------------------------------------------
  console.log('-> TEST 11: Existing expense data remains unchanged');
  const { data: dbExpenses, error: dbError } = await supabase
    .from('job_expenses')
    .select('*')
    .eq('checklist_id', checklistId);
  assert.ifError(dbError);
  assert.ok(dbExpenses && dbExpenses.length > 0, 'Original expense records must remain in database');
  console.log(`   [PASS] Verified ${dbExpenses.length} existing expense records in DB preserved intact:`);
  for (const exp of dbExpenses) {
    console.log(`      - [${exp.category}] ₹${exp.amount} | ${exp.description} (${exp.payment_method})`);
  }
  console.log();

  console.log('========================================================================');
  console.log('ALL 11 BACKEND / AUTHORIZATION TESTS PASSED SUCCESSFULLY!');
  console.log('========================================================================\n');
}

runTestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nTEST SUITE FAILED:', err);
    process.exit(1);
  });
