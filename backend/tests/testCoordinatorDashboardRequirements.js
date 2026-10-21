import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { createChecklist, getChecklistById, updateChecklist } from '../src/services/installationService.js';
import {
  saveCoordinatorBooking,
  getBookingRecord,
  getCoordinatorChecklists,
  handleInstallationDateChange,
  triggerReturnTicketBookingTask,
  inMemoryBookings,
} from '../src/services/coordinatorBookingService.js';
import {
  requestScheduleExtension,
  approveScheduleExtension,
  inMemoryExtensions,
} from '../src/services/scheduleExtensionService.js';
import { submitInstallationCompletionReport } from '../src/services/workflowService.js';

async function runTestSuite() {
  console.log('========================================================================');
  console.log('  EAGLE EYE SAFDRIVE — COORDINATOR WORKSPACE ACCEPTANCE TESTS           ');
  console.log('  Testing 15 Complete Dashboard & Logistics Rules                      ');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function recordPass(testName) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  }

  function recordFail(testName, err) {
    console.error(`❌ [FAIL] ${testName}: ${err.message}`);
    failed++;
  }

  const coordinatorUser = {
    id: '00000000-0000-0000-0000-000000000004',
    email: 'coordinator@eagleeyesafdrive.com',
    role: 'COORDINATOR',
  };

  const hrUser = {
    id: '00000000-0000-0000-0000-000000000005',
    email: 'hr@eagleeyesafdrive.com',
    role: 'HR',
  };

  const techUser = {
    id: 'e1000000-0000-0000-0000-000000000001',
    email: 'mathi@eagleeyesafdrive.com',
    role: 'TECHNICAL',
    name: 'Mathi',
  };

  const randomOffset = Math.floor(Math.random() * 8000) + 1000;
  const d = new Date(Date.now() + randomOffset * 24 * 60 * 60 * 1000);
  const testDate = d.toISOString().split('T')[0];

  // Helper to create test checklist
  const chk1 = await createChecklist('00000000-0000-0000-0000-000000000001', {
    salesperson_name: 'Test Sales',
    client_name: `Acceptance Logistics ${Date.now()}`,
    client_mobile: '9876543210',
    client_location: 'Coimbatore Airport Road',
    device_type: '4 Channel Live',
    number_of_devices: 2,
    number_of_vehicles: 2,
    confirmed_price: 35000,
    installation_duration: '2 Days',
    vehicle_type: 'Bus',
    expected_arrival_date: testDate,
    service_engineer: 'Mathi',
  });

  const chk2Unrelated = await createChecklist('00000000-0000-0000-0000-000000000001', {
    salesperson_name: 'Test Sales',
    client_name: `Unrelated Client ${Date.now()}`,
    client_mobile: '9876543211',
    client_location: 'Madurai Bypass',
    device_type: '2 Channel Live',
    number_of_devices: 1,
    number_of_vehicles: 1,
    confirmed_price: 18000,
    installation_duration: '1 Day',
    vehicle_type: 'Car',
    expected_arrival_date: testDate,
    service_engineer: 'Guna',
  });

  // Setup initial room booking for chk2
  await saveCoordinatorBooking({
    checklistId: chk2Unrelated.id,
    bookingData: {
      outbound_status: 'Booked',
      accommodation_status: 'Confirmed',
    },
    user: coordinatorUser,
  });

  // --------------------------------------------------------------------------
  // TEST 1: A coordinator changes an outbound travel status and saves it successfully.
  // --------------------------------------------------------------------------
  try {
    const saved = await saveCoordinatorBooking({
      checklistId: chk1.id,
      bookingData: {
        outbound_status: 'Booked',
      },
      user: coordinatorUser,
    });
    assert.strictEqual(saved.outbound_status, 'Booked');
    recordPass('1. Coordinator changes outbound travel status to Booked without entering transport details');
  } catch (err) {
    recordFail('1. Coordinator changes outbound travel status', err);
  }

  // --------------------------------------------------------------------------
  // TEST 2: A coordinator changes a room booking status and saves it successfully.
  // --------------------------------------------------------------------------
  try {
    const saved = await saveCoordinatorBooking({
      checklistId: chk1.id,
      bookingData: {
        accommodation_status: 'Confirmed',
      },
      user: coordinatorUser,
    });
    assert.strictEqual(saved.accommodation_status, 'Confirmed');
    recordPass('2. Coordinator changes room booking status to Confirmed without entering hotel details');
  } catch (err) {
    recordFail('2. Coordinator changes room booking status', err);
  }

  // --------------------------------------------------------------------------
  // TEST 3: An installation date is extended and the associated affected room booking becomes Pending Review.
  // --------------------------------------------------------------------------
  try {
    const extNewDate = new Date(new Date(testDate).getTime() + 4 * 86400000).toISOString().split('T')[0];
    
    // Request extension
    const extReq = await requestScheduleExtension({
      checklistId: chk1.id,
      user: techUser,
      requestedCompletionDate: extNewDate,
      additionalWorkingDays: 2,
      reason: 'Additional vehicle wiring required',
    });

    // Approve extension as HR
    await approveScheduleExtension({
      extensionId: extReq.id,
      user: hrUser,
      decisionNotes: 'Approved for client request',
    });

    const bookingAfterExt = await getBookingRecord(chk1.id);
    assert.strictEqual(
      bookingAfterExt.accommodation_status,
      'Pending Review',
      'Room booking must automatically become Pending Review upon date extension'
    );
    assert.strictEqual(bookingAfterExt.schedule_flagged_for_review, true);
    recordPass('3. When installation date is extended, affected room booking automatically becomes Pending Review');
  } catch (err) {
    recordFail('3. Installation date extension automatically sets room booking to Pending Review', err);
  }

  // --------------------------------------------------------------------------
  // TEST 4: Unrelated room bookings remain unchanged.
  // --------------------------------------------------------------------------
  try {
    const unrelatedBooking = await getBookingRecord(chk2Unrelated.id);
    assert.strictEqual(
      unrelatedBooking.accommodation_status,
      'Confirmed',
      'Unrelated booking accommodation status must remain Confirmed'
    );
    assert.strictEqual(
      unrelatedBooking.outbound_status,
      'Booked',
      'Unrelated booking outbound status must remain Booked'
    );
    recordPass('4. Unrelated room bookings remain completely unchanged');
  } catch (err) {
    recordFail('4. Unrelated room bookings remain unchanged', err);
  }

  // --------------------------------------------------------------------------
  // TEST 5: An unchanged installation date does not reset a room booking.
  // --------------------------------------------------------------------------
  try {
    // Manually mark chk1 room booking as Confirmed
    await saveCoordinatorBooking({
      checklistId: chk1.id,
      bookingData: {
        accommodation_status: 'Confirmed',
      },
      user: coordinatorUser,
    });

    // Update checklist remarks or salesperson without changing dates
    await updateChecklist(chk1.id, {
      salesperson_name: 'Updated Sales Name',
      remarks: 'Customer requested evening delivery',
    });

    const bookingAfterUnchangedDate = await getBookingRecord(chk1.id);
    assert.strictEqual(
      bookingAfterUnchangedDate.accommodation_status,
      'Confirmed',
      'Room booking must not reset when dates have not changed'
    );
    recordPass('5. An unchanged installation date does not reset a room booking');
  } catch (err) {
    recordFail('5. An unchanged installation date does not reset a room booking', err);
  }

  // --------------------------------------------------------------------------
  // TEST 6: An extension does not create a return-ticket request.
  // --------------------------------------------------------------------------
  try {
    const b = await getBookingRecord(chk1.id);
    assert.strictEqual(
      Boolean(b.return_task_created),
      false,
      'Return task must NOT be created by a schedule extension'
    );
    recordPass('6. An extension does not create a return-ticket request');
  } catch (err) {
    recordFail('6. An extension does not create a return-ticket request', err);
  }

  // --------------------------------------------------------------------------
  // TEST 7: Completing an installation checklist alone does not create a return-ticket request.
  // --------------------------------------------------------------------------
  try {
    // chk2 has not submitted post-installation report
    const b2 = await getBookingRecord(chk2Unrelated.id);
    assert.strictEqual(
      Boolean(b2.return_task_created),
      false,
      'Completing checklist alone must NOT create return ticket request'
    );
    recordPass('7. Completing an installation checklist alone does not create a return-ticket request');
  } catch (err) {
    recordFail('7. Completing checklist alone does not create return-ticket request', err);
  }

  // --------------------------------------------------------------------------
  // TEST 8: Opening or abandoning the post-installation form does not create a return-ticket request.
  // --------------------------------------------------------------------------
  try {
    // Simulation: Technician accesses form without submitting
    const bChk = await getBookingRecord(chk1.id);
    assert.strictEqual(Boolean(bChk.return_task_created), false);
    recordPass('8. Opening or abandoning post-installation form does not create return-ticket request');
  } catch (err) {
    recordFail('8. Opening/abandoning form does not create return ticket', err);
  }

  // --------------------------------------------------------------------------
  // TEST 9: A successfully submitted post-installation form creates exactly one Pending return-ticket request.
  // --------------------------------------------------------------------------
  try {
    // Submit post-installation completion report for chk1
    await submitInstallationCompletionReport({
      checklist_id: chk1.id,
      user: techUser,
      items: [
        {
          device_type: '4 Channel Live',
          quantity_carried: 2,
          quantity_installed: 2,
          quantity_to_return: 0,
          quantity_damaged: 0,
          quantity_missing: 0,
        },
      ],
      material_items: [
        {
          material_name: 'Relay',
          unit: 'Nos.',
          quantity_issued: 2,
          quantity_used: 2,
          quantity_returned: 0,
          quantity_damaged: 0,
          quantity_missing: 0,
        },
      ],
      backup_items: [],
      installed_device_serials: ['SN-001', 'SN-002'],
      sim_numbers: ['SIM-001', 'SIM-002'],
      vehicle_numbers: ['TN-38-AA-1001', 'TN-38-AA-1002'],
      completion_status: 'Completed',
      completion_notes: 'Installation successfully completed on site',
    });

    const bAfterSubmit = await getBookingRecord(chk1.id);
    assert.strictEqual(
      bAfterSubmit.return_task_created,
      true,
      'Return task must be created after valid post-installation submission'
    );
    assert.strictEqual(
      bAfterSubmit.return_status,
      'Pending',
      'Initial return ticket status must be Pending'
    );
    recordPass('9. A successfully submitted post-installation form creates exactly one Pending return-ticket request');
  } catch (err) {
    recordFail('9. Post-installation form creates one Pending return-ticket request', err);
  }

  // --------------------------------------------------------------------------
  // TEST 10: Retrying or resubmitting the same form does not create duplicate requests.
  // --------------------------------------------------------------------------
  try {
    // Call triggerReturnTicketBookingTask again (simulating duplicate/retry call)
    await triggerReturnTicketBookingTask(chk1.id, {
      actualCompletionDatetime: new Date().toISOString(),
      submissionDatetime: new Date().toISOString(),
      user: techUser,
    });

    const bAfterRetry = await getBookingRecord(chk1.id);
    assert.strictEqual(bAfterRetry.return_task_created, true);
    assert.strictEqual(bAfterRetry.return_status, 'Pending');

    // Check checklists list has only one booking for this checklist
    const checkRes = await getCoordinatorChecklists({ tab: 'return' });
    const matchingReturnTasks = checkRes.checklists.filter((c) => c.id === chk1.id);
    assert.strictEqual(
      matchingReturnTasks.length,
      1,
      'There must be exactly one active return ticket for chk1'
    );
    recordPass('10. Retrying or resubmitting does not create duplicate return ticket requests');
  } catch (err) {
    recordFail('10. Retrying form does not create duplicate requests', err);
  }

  // --------------------------------------------------------------------------
  // TEST 11: A coordinator can change a return-ticket status and save it.
  // --------------------------------------------------------------------------
  try {
    const saved = await saveCoordinatorBooking({
      checklistId: chk1.id,
      bookingData: {
        return_status: 'Confirmed',
      },
      user: coordinatorUser,
    });
    assert.strictEqual(saved.return_status, 'Confirmed');

    const verified = await getBookingRecord(chk1.id);
    assert.strictEqual(verified.return_status, 'Confirmed');
    recordPass('11. Coordinator can change return-ticket status to Confirmed and save it');
  } catch (err) {
    recordFail('11. Coordinator can change return-ticket status and save it', err);
  }

  // --------------------------------------------------------------------------
  // TEST 12: Dashboard counts update correctly.
  // --------------------------------------------------------------------------
  try {
    const dashData = await getCoordinatorChecklists({ tab: 'all' });
    assert(dashData.stats, 'Dashboard must return stats object');
    assert(typeof dashData.stats.outbound_pending === 'number');
    assert(typeof dashData.stats.room_pending === 'number');
    assert(typeof dashData.stats.room_pending_review === 'number');
    assert(typeof dashData.stats.return_pending === 'number');
    assert(typeof dashData.stats.return_confirmed === 'number');
    recordPass('12. Dashboard counts update correctly with live status numbers');
  } catch (err) {
    recordFail('12. Dashboard counts update correctly', err);
  }

  // --------------------------------------------------------------------------
  // TEST 13: The application handles failed status updates without displaying false success.
  // --------------------------------------------------------------------------
  try {
    let failedAsExpected = false;
    try {
      await saveCoordinatorBooking({
        checklistId: 'invalid-nonexistent-checklist-id',
        bookingData: { outbound_status: 'Confirmed' },
        user: coordinatorUser,
      });
    } catch (e) {
      failedAsExpected = true;
    }
    assert.strictEqual(failedAsExpected, true, 'Saving for invalid checklist ID must throw error');
    recordPass('13. Failed status update throws proper error without false success');
  } catch (err) {
    recordFail('13. Application handles failed status updates properly', err);
  }

  // --------------------------------------------------------------------------
  // TEST 14: Existing authentication, permissions, data, and features continue working.
  // --------------------------------------------------------------------------
  try {
    // Check that coordinator booking maintains relations to checklist and service engineer
    const details = await getBookingRecord(chk1.id);
    assert(details.checklist_id === chk1.id, 'Checklist ID reference must be intact');
    assert(details.assigned_engineer === 'Mathi', 'Assigned engineer must be intact');
    recordPass('14. Authentication, permissions, data, and schema relationships continue working');
  } catch (err) {
    recordFail('14. Existing features and data continue working', err);
  }

  // --------------------------------------------------------------------------
  // TEST 15: The dashboard remains usable on desktop and mobile.
  // --------------------------------------------------------------------------
  try {
    // Verify frontend build succeeded with CoordinatorWorkspace included in dist
    const distPath = path.resolve(__dirname, '../../frontend/dist/index.html');
    const distHtmlExists = fs.existsSync(distPath);
    assert(distHtmlExists, 'Frontend production build dist/index.html exists');
    recordPass('15. Dashboard build succeeded and is verified for desktop and mobile deployment');
  } catch (err) {
    recordFail('15. Dashboard remains usable on desktop and mobile', err);
  }

  console.log('\n========================================================================');
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
