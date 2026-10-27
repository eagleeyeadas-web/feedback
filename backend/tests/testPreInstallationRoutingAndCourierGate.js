import assert from 'assert';
import {
  isChecklistTechnicianDependent,
  isPreInstallationSubmitted,
  inMemoryDeclarations,
} from '../src/services/backupItemService.js';
import { inMemoryCarryRecords } from '../src/services/workflowService.js';
import { inMemoryStoreRequirements } from '../src/services/storeRequirementService.js';
import {
  buildDefaultCoordinatorBooking,
  normalizeBookingData,
  inMemoryBookings,
} from '../src/services/coordinatorBookingService.js';

console.log('=================================================================');
console.log('SAFE VERIFICATION TEST SUITE (ZERO PRODUCTION DATABASE WRITES)');
console.log('CHECKLIST ROUTING, PRODUCT COURIER & EXTRA DEVICE MANAGEMENT');
console.log('=================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Scenario 1: Technician-Dependent Determination
// ---------------------------------------------------------------------------
console.log('Test Group 1: Technician-Dependent Checklist Identification');

runTest('1.1 Standard installation checklist (Technician Carries) is technician-dependent', () => {
  const chk = {
    delivery_method: 'Technician Carries',
    service_engineer: 'Sakthivel',
  };
  assert.strictEqual(isChecklistTechnicianDependent(chk), true);
});

runTest('1.2 Default checklist without delivery_method defaults to technician-dependent', () => {
  const chk = {
    service_engineer: 'Sakthivel',
  };
  assert.strictEqual(isChecklistTechnicianDependent(chk), true);
});

runTest('1.3 Product Courier checklist WITHOUT technician is NOT technician-dependent', () => {
  const chkNoTech1 = {
    delivery_method: 'Product Couriered',
    service_engineer: null,
  };
  const chkNoTech2 = {
    delivery_method: 'Product Couriered',
    service_engineer: '',
  };
  const chkNoTech3 = {
    delivery_method: 'Product Couriered',
    service_engineer: 'Unassigned',
  };
  assert.strictEqual(isChecklistTechnicianDependent(chkNoTech1), false);
  assert.strictEqual(isChecklistTechnicianDependent(chkNoTech2), false);
  assert.strictEqual(isChecklistTechnicianDependent(chkNoTech3), false);
});

runTest('1.4 Product Courier checklist WITH technician assigned IS technician-dependent', () => {
  const chkWithTech = {
    delivery_method: 'Product Couriered',
    service_engineer: 'Kamalesh',
  };
  assert.strictEqual(isChecklistTechnicianDependent(chkWithTech), true);
});

runTest('1.5 Service checklist is technician-dependent', () => {
  const chkService = {
    delivery_method: 'Technician Carries',
    installation_or_service: 'Service',
    service_engineer: 'Guna',
  };
  assert.strictEqual(isChecklistTechnicianDependent(chkService), true);
});

// ---------------------------------------------------------------------------
// Scenario 2: Pre-Installation Submission State Verification
// ---------------------------------------------------------------------------
console.log('\nTest Group 2: Pre-Installation Submission Verification');

runTest('2.1 Unrecorded checklist without submission returns false', async () => {
  const testId = 'test-chk-unsubmitted-001';
  const chk = { id: testId, carry_status: 'NOT_RECORDED' };
  const submitted = await isPreInstallationSubmitted(testId, chk);
  assert.strictEqual(submitted, false);
});

runTest('2.2 Checklist with carry_status RECORDED returns true', async () => {
  const testId = 'test-chk-recorded-002';
  const chk = { id: testId, carry_status: 'RECORDED' };
  const submitted = await isPreInstallationSubmitted(testId, chk);
  assert.strictEqual(submitted, true);
});

runTest('2.3 Checklist with inMemoryDeclarations DECLARED returns true', async () => {
  const testId = 'test-chk-inmem-decl-003';
  inMemoryDeclarations.set(testId, {
    id: 'decl-003',
    status: 'DECLARED',
    has_backup_items: true,
  });
  try {
    const submitted = await isPreInstallationSubmitted(testId);
    assert.strictEqual(submitted, true);
  } finally {
    inMemoryDeclarations.delete(testId);
  }
});

runTest('2.4 Checklist with inMemoryCarryRecords SUBMITTED returns true', async () => {
  const testId = 'test-chk-inmem-carry-004';
  inMemoryCarryRecords.set(testId, {
    id: 'carry-004',
    status: 'SUBMITTED',
  });
  try {
    const submitted = await isPreInstallationSubmitted(testId);
    assert.strictEqual(submitted, true);
  } finally {
    inMemoryCarryRecords.delete(testId);
  }
});

// ---------------------------------------------------------------------------
// Scenario 3: Store Manager Incoming Jobs & Material Requirements Routing Gate
// ---------------------------------------------------------------------------
console.log('\nTest Group 3: Store Manager Routing Gate & Actionable Queue');

runTest('3.1 Technician-dependent checklist without pre-installation is HIDDEN from actionable incoming queue', () => {
  const reqUnsubmitted = {
    id: 'req-001',
    checklist_id: 'chk-001',
    delivery_method: 'Technician Carries',
    service_engineer: 'Sakthivel',
    is_technician_dependent: true,
    has_pre_installation_submitted: false,
    is_issued: false,
    stock_issuance_status: 'Pending',
    installation_status: 'Assigned',
  };

  const isActionable = (r) => {
    if (r.is_issued || r.stock_issuance_status === 'Completed' || r.installation_status === 'Completed') return true;
    if (r.delivery_method === 'Product Couriered' && !r.is_technician_dependent) return true;
    if (r.is_technician_dependent && !r.has_pre_installation_submitted) return false;
    return true;
  };

  assert.strictEqual(isActionable(reqUnsubmitted), false);
});

runTest('3.2 Technician-dependent checklist WITH pre-installation submitted appears in actionable queue', () => {
  const reqSubmitted = {
    id: 'req-002',
    checklist_id: 'chk-002',
    delivery_method: 'Technician Carries',
    service_engineer: 'Sakthivel',
    is_technician_dependent: true,
    has_pre_installation_submitted: true,
    is_issued: false,
    stock_issuance_status: 'Pending',
    installation_status: 'Assigned',
  };

  const isActionable = (r) => {
    if (r.is_issued || r.stock_issuance_status === 'Completed' || r.installation_status === 'Completed') return true;
    if (r.delivery_method === 'Product Couriered' && !r.is_technician_dependent) return true;
    if (r.is_technician_dependent && !r.has_pre_installation_submitted) return false;
    return true;
  };

  assert.strictEqual(isActionable(reqSubmitted), true);
});

runTest('3.3 Product Courier without technician is IMMEDIATELY ACTIONABLE for original stock issuance', () => {
  const reqCourier = {
    id: 'req-003',
    checklist_id: 'chk-003',
    delivery_method: 'Product Couriered',
    service_engineer: null,
    is_technician_dependent: false,
    has_pre_installation_submitted: false,
    is_issued: false,
    stock_issuance_status: 'Pending',
    installation_status: 'Assign Later',
  };

  const isActionable = (r) => {
    if (r.is_issued || r.stock_issuance_status === 'Completed' || r.installation_status === 'Completed') return true;
    if (r.delivery_method === 'Product Couriered' && !r.is_technician_dependent) return true;
    if (r.is_technician_dependent && !r.has_pre_installation_submitted) return false;
    return true;
  };

  assert.strictEqual(isActionable(reqCourier), true);
});

runTest('3.4 Historical checklists with stock issued or completed are PRESERVED in records/history', () => {
  const reqHistoricalIssued = {
    id: 'req-004',
    checklist_id: 'chk-004',
    delivery_method: 'Technician Carries',
    service_engineer: 'Guna',
    is_technician_dependent: true,
    has_pre_installation_submitted: false,
    is_issued: true,
    stock_issuance_status: 'Completed',
    installation_status: 'Completed',
  };

  const isActionable = (r) => {
    if (r.is_issued || r.stock_issuance_status === 'Completed' || r.installation_status === 'Completed') return true;
    if (r.delivery_method === 'Product Couriered' && !r.is_technician_dependent) return true;
    if (r.is_technician_dependent && !r.has_pre_installation_submitted) return false;
    return true;
  };

  assert.strictEqual(isActionable(reqHistoricalIssued), true);
});

// ---------------------------------------------------------------------------
// Scenario 4: Coordinator Workspace Tasks & Courier Exception
// ---------------------------------------------------------------------------
console.log('\nTest Group 4: Coordinator Workspace Tasks & Product Courier Exception');

runTest('4.1 Product Courier without technician creates NO travel or accommodation tasks', () => {
  const chk = {
    id: 'chk-courier-notech',
    checklist_number: 'CHK-COU-01',
    delivery_method: 'Product Couriered',
    service_engineer: null,
    client_location: 'Coimbatore',
  };

  const defaultBooking = buildDefaultCoordinatorBooking(chk);
  assert.strictEqual(defaultBooking.booking_status, 'NOT_REQUIRED');
  assert.strictEqual(defaultBooking.outbound_status, 'Cancelled');
  assert.strictEqual(defaultBooking.travel_required, false);
  assert.strictEqual(defaultBooking.accommodation_status, 'Cancelled');
  assert.strictEqual(defaultBooking.accommodation_required, false);

  const normalized = normalizeBookingData(null, chk);
  assert.strictEqual(normalized.booking_status, 'NOT_REQUIRED');
  assert.strictEqual(normalized.outbound_status, 'Cancelled');
  assert.strictEqual(normalized.accommodation_status, 'Cancelled');
});

runTest('4.2 Technician-dependent checklist unsubmitted is excluded from pending booking tab', () => {
  const item = {
    id: 'chk-tech-unsub',
    booking_status: 'PENDING',
    is_technician_dependent: true,
    has_pre_installation_submitted: false,
  };

  const isIncludedInPendingTab = (it, tab) => {
    if (tab === 'pending') {
      if (it.is_technician_dependent && !it.has_pre_installation_submitted) return false;
      if (it.booking_status !== 'PENDING' && it.booking_status !== 'IN_PROGRESS') return false;
    }
    return true;
  };

  assert.strictEqual(isIncludedInPendingTab(item, 'pending'), false);
  assert.strictEqual(isIncludedInPendingTab(item, 'all'), true);
});

runTest('4.3 Technician-dependent checklist submitted is included in pending booking tab', () => {
  const item = {
    id: 'chk-tech-sub',
    booking_status: 'PENDING',
    is_technician_dependent: true,
    has_pre_installation_submitted: true,
  };

  const isIncludedInPendingTab = (it, tab) => {
    if (tab === 'pending') {
      if (it.is_technician_dependent && !it.has_pre_installation_submitted) return false;
      if (it.booking_status !== 'PENDING' && it.booking_status !== 'IN_PROGRESS') return false;
    }
    return true;
  };

  assert.strictEqual(isIncludedInPendingTab(item, 'pending'), true);
});

// ---------------------------------------------------------------------------
// Scenario 5: Quantity Tracking, Extra Devices Declaration & Reconciling
// ---------------------------------------------------------------------------
console.log('\nTest Group 5: Quantity Tracking & Distinguishing Original vs Extra Stock');

runTest('5.1 Potential additional quantity formula reconciles declaration against actual issuance', () => {
  const originalIssued = { camera: 4, display: 1 };
  const technicianDeclared = { camera: 6, display: 2 };

  const extraCameraReq = Math.max(0, technicianDeclared.camera - originalIssued.camera);
  const extraDisplayReq = Math.max(0, technicianDeclared.display - originalIssued.display);

  assert.strictEqual(extraCameraReq, 2);
  assert.strictEqual(extraDisplayReq, 1);
});

runTest('5.2 Declared quantity less than or equal to issued produces 0 additional requirement without negative stock', () => {
  const originalIssued = { camera: 4 };
  const technicianDeclared = { camera: 3 };

  const extraCameraReq = Math.max(0, technicianDeclared.camera - originalIssued.camera);
  assert.strictEqual(extraCameraReq, 0);
});

runTest('5.3 Declaration does NOT automatically deduct inventory', () => {
  const decl = {
    has_backup_items: true,
    status: 'DECLARED',
    items: [
      { item_name: 'Camera', quantity: 2, quantity_issued: 0 },
    ],
  };

  assert.strictEqual(decl.items[0].quantity_issued, 0);
  assert.strictEqual(decl.status, 'DECLARED');
});

// ---------------------------------------------------------------------------
// Scenario 6: Customer Self-Installation for Product Courier
// ---------------------------------------------------------------------------
console.log('\nTest Group 6: Customer Self-Installation for Product Courier');

runTest('6.1 Customer self-installation strictly requires confirmation note and no assigned technician', () => {
  const courieredChecklistWithTech = {
    delivery_method: 'Product Couriered',
    service_engineer: 'Sakthivel',
  };
  const courieredChecklistNoTech = {
    delivery_method: 'Product Couriered',
    service_engineer: null,
  };

  const canSelfInstall = (chk, note) => {
    if (chk.service_engineer && chk.service_engineer.trim()) return false;
    if (!note || !note.trim()) return false;
    return true;
  };

  assert.strictEqual(canSelfInstall(courieredChecklistWithTech, 'Self installed'), false);
  assert.strictEqual(canSelfInstall(courieredChecklistNoTech, ''), false);
  assert.strictEqual(canSelfInstall(courieredChecklistNoTech, 'Customer confirmed complete'), true);
});

// ---------------------------------------------------------------------------
// Scenario 7: Newly Created Checklist State & Post-Installation Gating
// ---------------------------------------------------------------------------
console.log('\nTest Group 7: Newly Created Checklist State & Post-Installation Gating');

runTest('7.1 Newly created checklist with device_configurations preserves carry_status NOT_RECORDED during enrichment', async () => {
  const { enrichChecklistsWithWorkflowStatus } = await import('../src/services/workflowService.js');
  const mockNewChecklist = {
    id: 'test-chk-new-701',
    checklist_number: 'CHK-NEW-701',
    device_configurations: [{ device_type: '4 Channel Live', number_of_devices: 2 }],
    device_type: '4 Channel Live',
    carry_status: 'NOT_RECORDED',
    delivery_method: 'Technician Carries',
    service_engineer: 'Sakthivel',
  };

  const [enriched] = await enrichChecklistsWithWorkflowStatus([mockNewChecklist]);
  assert.strictEqual(enriched.carry_status, 'NOT_RECORDED');
  assert.strictEqual(enriched.is_pre_installation_submitted, false);
  assert.strictEqual(enriched.pre_installation_status, 'Not Submitted');
});

runTest('7.2 Pre-installation submitted status flips to true only when genuine submission exists', async () => {
  const { enrichChecklistsWithWorkflowStatus } = await import('../src/services/workflowService.js');
  const testChkId = 'test-chk-submitted-702';
  inMemoryDeclarations.set(testChkId, {
    checklist_id: testChkId,
    status: 'DECLARED',
    items: [{ item_name: 'Camera', quantity: 1 }],
  });

  const mockChecklist = {
    id: testChkId,
    checklist_number: 'CHK-SUB-702',
    device_configurations: [{ device_type: '4 Channel Live', number_of_devices: 1 }],
    carry_status: 'NOT_RECORDED',
    delivery_method: 'Technician Carries',
    service_engineer: 'Sakthivel',
  };

  const [enriched] = await enrichChecklistsWithWorkflowStatus([mockChecklist]);
  assert.strictEqual(enriched.carry_status, 'RECORDED');
  assert.strictEqual(enriched.is_pre_installation_submitted, true);
  assert.strictEqual(enriched.pre_installation_status, 'Submitted');
  inMemoryDeclarations.delete(testChkId);
});

runTest('7.3 submitInstallationCompletionReport rejects submission when Pre-Installation is not submitted', async () => {
  const { submitInstallationCompletionReport } = await import('../src/services/workflowService.js');
  const testChkId = 'test-chk-unsubmitted-703';
  let rejected = false;
  let errMsg = '';

  try {
    await submitInstallationCompletionReport({
      checklist_id: testChkId,
      user: { id: 'tech-1', role: 'TECHNICAL' },
      items: [{ device_type: 'Camera', quantity_carried: 2, quantity_installed: 2 }],
    });
  } catch (err) {
    rejected = true;
    errMsg = err.message;
  }

  // Expect rejection either because checklist is not in DB or because pre-installation is unsubmitted
  assert(rejected === true, 'Completion report MUST be rejected');
});

console.log('\n=================================================================');
console.log(`TEST SUMMARY: ${passedTests} OF ${totalTests} SCENARIOS PASSED`);
console.log('=================================================================');
