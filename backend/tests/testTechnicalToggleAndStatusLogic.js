import assert from 'assert';
import { enrichChecklistsWithWorkflowStatus } from '../src/services/workflowService.js';

async function testTechnicalToggleAndStatusLogic() {
  console.log('=================================================================');
  console.log('🧪 TESTING TECHNICAL WORKSPACE TOGGLE & STATUS SYNCHRONIZATION');
  console.log('=================================================================\n');

  // Frontend logic mirror functions (from TechnicalWorkspace.jsx)
  const isJobCompleted = (item) => {
    const status = (item.installation_status || '').trim().toLowerCase();
    return status === 'completed' || status === 'site work completed';
  };

  const isJobAssigned = (item) => {
    const status = (item.installation_status || '').trim().toLowerCase();
    return !isJobCompleted(item) && status !== 'cancelled';
  };

  const getJobAction = (item) => {
    const isCompleted = isJobCompleted(item);
    if (isCompleted) {
      return 'View Installation Report';
    }
    const isCarryDone = (item.carry_status || '').toUpperCase() === 'RECORDED';
    if (!isCarryDone) {
      return 'Record Devices Carried';
    }
    if (item.has_completion_report) {
      return 'View Installation Report';
    }
    return 'Record Installed & Returned Devices';
  };

  const matchesFilter = (item, selectedEngineer, search) => {
    let matchesEngineer = true;
    if (selectedEngineer !== 'all') {
      const eng = (item.service_engineer || '').toLowerCase();
      matchesEngineer = eng.includes(selectedEngineer.toLowerCase());
    }
    let matchesSearch = true;
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      matchesSearch =
        (item.client_name || '').toLowerCase().includes(s) ||
        (item.checklist_number || '').toLowerCase().includes(s) ||
        (item.service_engineer || '').toLowerCase().includes(s) ||
        (item.service_assistant || '').toLowerCase().includes(s) ||
        (item.client_location || '').toLowerCase().includes(s);
    }
    return matchesEngineer && matchesSearch;
  };

  // -------------------------------------------------------------
  // TEST SCENARIO 1: Assigned Job without a carry record
  // -------------------------------------------------------------
  console.log('--- TEST 1: Assigned job without a carry record ---');
  const job1 = {
    id: 'job-101',
    checklist_number: 'EE-INST-20261012-0001',
    client_name: 'Alpha Logistics',
    installation_status: 'Assigned',
    carry_status: 'NOT_RECORDED',
    service_engineer: 'Kumar',
    reconciliation_status: 'SALES_CREATED',
  };

  assert.strictEqual(isJobAssigned(job1), true, 'Job 1 should be classified as Assigned');
  assert.strictEqual(isJobCompleted(job1), false, 'Job 1 should NOT be classified as Completed');
  assert.strictEqual(getJobAction(job1), 'Record Devices Carried', 'Job 1 action must be Record Devices Carried');
  console.log('✅ Passed: Job 1 correctly routed to Assigned Jobs with "Record Devices Carried" action.\n');

  // -------------------------------------------------------------
  // TEST SCENARIO 2: Job with recorded carry report awaiting installation completion
  // -------------------------------------------------------------
  console.log('--- TEST 2: Job with recorded carry report awaiting completion ---');
  const job2 = {
    id: 'job-102',
    checklist_number: 'EE-INST-20261012-0002',
    client_name: 'Beta Cargo',
    installation_status: 'In Progress',
    carry_status: 'RECORDED',
    service_engineer: 'Mathi',
    reconciliation_status: 'CARRY_RECORDED',
  };

  assert.strictEqual(isJobAssigned(job2), true, 'Job 2 should be classified as Assigned');
  assert.strictEqual(isJobCompleted(job2), false, 'Job 2 should NOT be classified as Completed');
  assert.strictEqual(getJobAction(job2), 'Record Installed & Returned Devices', 'Job 2 action must be Record Installed & Returned Devices');
  console.log('✅ Passed: Job 2 correctly routed to Assigned Jobs with "Record Installed & Returned Devices" action.\n');

  // -------------------------------------------------------------
  // TEST SCENARIO 3: Completed Job
  // -------------------------------------------------------------
  console.log('--- TEST 3: Completed job ---');
  const job3 = {
    id: 'job-103',
    checklist_number: 'EE-INST-20261012-0003',
    client_name: 'Gamma Transport',
    installation_status: 'Completed',
    carry_status: 'RECORDED',
    service_engineer: 'Kumar',
    reconciliation_status: 'FULLY_RECONCILED',
    has_completion_report: true,
  };

  assert.strictEqual(isJobCompleted(job3), true, 'Job 3 should be classified as Completed');
  assert.strictEqual(isJobAssigned(job3), false, 'Job 3 should NOT be in Assigned Jobs');
  assert.strictEqual(getJobAction(job3), 'View Installation Report', 'Job 3 action must be View Installation Report');
  console.log('✅ Passed: Job 3 correctly routed to Completed Jobs with "View Installation Report" action.\n');

  // -------------------------------------------------------------
  // TEST SCENARIO 4: Completed job with returns awaiting Store Manager verification
  // -------------------------------------------------------------
  console.log('--- TEST 4: Completed job awaiting Store Manager return verification ---');
  const job4 = {
    id: 'job-104',
    checklist_number: 'EE-INST-20261012-0004',
    client_name: 'Delta Express',
    installation_status: 'Completed',
    carry_status: 'RECORDED',
    service_engineer: 'Suresh',
    reconciliation_status: 'PENDING_STORE_VERIFICATION',
    has_completion_report: true,
  };

  assert.strictEqual(isJobCompleted(job4), true, 'Job 4 must be classified as Completed even when returns pending store verification');
  assert.strictEqual(isJobAssigned(job4), false, 'Job 4 must NOT reappear in Assigned Jobs');
  assert.strictEqual(getJobAction(job4), 'View Installation Report', 'Job 4 action must be View Installation Report');
  assert.strictEqual(job4.reconciliation_status, 'PENDING_STORE_VERIFICATION', 'Reconciliation status preserved');
  console.log('✅ Passed: Job 4 is in Completed Jobs, keeping Store Manager return verification distinct from installation status.\n');

  // -------------------------------------------------------------
  // TEST SCENARIO 5: Mutual exclusivity & Toggle Counts
  // -------------------------------------------------------------
  console.log('--- TEST 5: Toggle counts & mutual exclusivity ---');
  const mockChecklists = [job1, job2, job3, job4];
  const assignedJobs = mockChecklists.filter(isJobAssigned);
  const completedJobs = mockChecklists.filter(isJobCompleted);

  assert.strictEqual(assignedJobs.length, 2, 'Assigned Jobs count should be 2');
  assert.strictEqual(completedJobs.length, 2, 'Completed Jobs count should be 2');
  assert.strictEqual(assignedJobs.length + completedJobs.length, mockChecklists.length, 'Jobs must be mutually exclusive');

  // Test Filter by Service Engineer
  const kumarAssigned = assignedJobs.filter((j) => matchesFilter(j, 'Kumar', ''));
  const kumarCompleted = completedJobs.filter((j) => matchesFilter(j, 'Kumar', ''));
  assert.strictEqual(kumarAssigned.length, 1, 'Kumar should have 1 assigned job');
  assert.strictEqual(kumarCompleted.length, 1, 'Kumar should have 1 completed job');

  // Test Search Filter
  const searchBetaAssigned = assignedJobs.filter((j) => matchesFilter(j, 'all', 'Beta Cargo'));
  const searchBetaCompleted = completedJobs.filter((j) => matchesFilter(j, 'all', 'Beta Cargo'));
  assert.strictEqual(searchBetaAssigned.length, 1, 'Search for Beta Cargo should yield 1 assigned job');
  assert.strictEqual(searchBetaCompleted.length, 0, 'Search for Beta Cargo should yield 0 completed jobs');
  console.log('✅ Passed: Mutual exclusivity, toggle counts, engineer filter, and search functioning accurately.\n');

  // -------------------------------------------------------------
  // TEST SCENARIO 6: Empty lists behavior
  // -------------------------------------------------------------
  console.log('--- TEST 6: Empty lists handling ---');
  const emptyChecklists = [];
  const emptyAssigned = emptyChecklists.filter(isJobAssigned);
  const emptyCompleted = emptyChecklists.filter(isJobCompleted);
  assert.strictEqual(emptyAssigned.length, 0);
  assert.strictEqual(emptyCompleted.length, 0);
  console.log('✅ Passed: Empty Assigned Jobs and Completed Jobs lists produce count (0) without exceptions.\n');

  // -------------------------------------------------------------
  // TEST SCENARIO 7: Backend enrichment & page reload persistence
  // -------------------------------------------------------------
  console.log('--- TEST 7: Backend enrichChecklistsWithWorkflowStatus & refresh persistence ---');
  const rawDbJobs = [
    { id: 'db-1', checklist_number: 'EE-1', installation_status: 'Assigned' },
    { id: 'db-2', checklist_number: 'EE-2', installation_status: 'Completed' },
    { id: 'db-3', checklist_number: 'EE-3', installation_status: 'In Progress' },
  ];

  const enriched = await enrichChecklistsWithWorkflowStatus(rawDbJobs);
  const enrichedAssigned = enriched.filter(isJobAssigned);
  const enrichedCompleted = enriched.filter(isJobCompleted);

  assert.strictEqual(enrichedAssigned.length, 2, 'Enriched assigned should be 2 (Assigned and In Progress)');
  assert.strictEqual(enrichedCompleted.length, 1, 'Enriched completed should be 1 (EE-2)');
  assert.strictEqual(enrichedCompleted[0].checklist_number, 'EE-2');

  console.log('✅ Passed: Completed job EE-2 remains Completed upon simulated page reload and does NOT reappear in Assigned Jobs.\n');

  console.log('=================================================================');
  console.log('🎉 ALL 7 TEST SCENARIOS PASSED WITH ZERO ERRORS!');
  console.log('=================================================================');
}

testTechnicalToggleAndStatusLogic().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
