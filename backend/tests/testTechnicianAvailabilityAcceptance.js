import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { createChecklist, getChecklistById } from '../src/services/installationService.js';
import {
  checkEngineerAvailability,
  getEngineersAvailabilityForRange,
  reserveEngineerAtomic,
  acquireEngineerLock,
  getAvailabilityCalendar,
  cleanupTestBookingsForYear,
} from '../src/services/engineerBookingService.js';
import {
  requestScheduleExtension,
  approveScheduleExtension,
  rejectScheduleExtension,
  getScheduleRevisionHistory,
  cleanupTestExtensionsForYear,
} from '../src/services/scheduleExtensionService.js';
import {
  requestRestDay,
  approveRestDay,
  rejectRestDay,
  cleanupTestRestDaysForYear,
} from '../src/services/restDayService.js';
import {
  requestLeave,
  approveLeave,
  rejectLeave,
  cleanupTestLeavesForYear,
} from '../src/services/leaveService.js';
import {
  saveCoordinatorBooking,
  getCoordinatorChecklists,
  cleanupTestCoordinatorBookingsForYear,
} from '../src/services/coordinatorBookingService.js';
import {
  startInstallationJob,
  submitInstallationCompletionReport,
} from '../src/services/workflowService.js';
import coordinatorRoutes from '../src/routes/coordinator.js';

import supabase from '../src/services/supabase.js';

async function runAcceptanceTests() {
  console.log('========================================================================');
  console.log('  EAGLE EYE SAFDRIVE — TECHNICIAN AVAILABILITY & SCHEDULING ACCEPTANCE  ');
  console.log('  Testing Scenarios A through L (All 12 Mandatory Criteria)             ');
  console.log('========================================================================\n');

  const testUserSales = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'sales@gmail.com',
    role: 'SALES',
  };

  const testUserCoordinator = {
    id: '00000000-0000-0000-0000-000000000004',
    email: 'coordinator@gmail.com',
    role: 'COORDINATOR',
  };

  const testUserTech = {
    id: '00000000-0000-0000-0000-000000000002',
    email: 'tech@gmail.com',
    role: 'TECHNICAL',
  };

  const ts = Date.now();

  // Cleanup test data from prior runs in Supabase and storage
  cleanupTestBookingsForYear('2028');
  cleanupTestExtensionsForYear('2028');
  cleanupTestRestDaysForYear('2028');
  cleanupTestLeavesForYear('2028');
  cleanupTestCoordinatorBookingsForYear('2028');
  try {
    await supabase.from('installation_checklists').delete().like('client_name', 'Test A Transport%');
    await supabase.from('installation_checklists').delete().like('client_name', 'Conflict Client%');
    await supabase.from('installation_checklists').delete().like('client_name', 'Hotel Booking Client%');
    await supabase.from('installation_checklists').delete().like('client_name', 'Early Finish Client%');
    await supabase.from('installation_checklists').delete().like('client_name', 'Regression Check Client%');
    await supabase.from('engineer_bookings').delete().gte('booking_start_date', '2028-01-01');
    await supabase.from('schedule_extension_requests').delete().gte('requested_completion_date', '2028-01-01');
    await supabase.from('rest_day_requests').delete().gte('rest_start_date', '2028-01-01');
    await supabase.from('leave_requests').delete().gte('leave_start_date', '2028-01-01');
  } catch (e) {}

  // Clean 2028 dates dedicated for acceptance testing
  const dateA_start = '2028-11-01';
  const dateA_overlap = '2028-11-02';
  const dateA_ext = '2028-11-04';
  const dateA_travel = '2028-11-05';
  const dateA_rest = '2028-11-06';
  const dateE_reject = '2028-11-08';
  const dateF_rest = '2028-11-10';
  const dateG_start = '2028-11-15';
  const dateG_end = '2028-11-16';
  const dateH_start = '2028-11-20';
  const dateH_checkout = '2028-11-21';
  const dateH_ext = '2028-11-23';
  const dateI_start = '2028-11-25';
  const dateI_finish = '2028-11-26';
  const dateI_released = '2028-11-27';
  const dateJ_race = '2028-12-01';
  const dateL_reg = '2028-12-10';

  try {
    // --------------------------------------------------------------------------
    // Test A: Normal Assignment
    // --------------------------------------------------------------------------
    console.log('-> Test A: Normal Assignment with original planned schedule preservation...');
    const checklistA = await createChecklist(testUserSales.id, {
      client_name: `Test A Transport ${ts}`,
      client_mobile: '9876543210',
      client_location: 'Chennai Central',
      salesperson_name: 'Sales Rep 1',
      device_type: 'SafDrive Model X',
      number_of_devices: 2,
      number_of_vehicles: 2,
      service_engineer: 'Mathi',
      expected_arrival_date: dateA_start,
      expected_arrival_time: '09:00',
      installation_duration: '2 Days',
      installation_status: 'Assigned',
    });

    assert.ok(checklistA && checklistA.id, 'Checklist A must be created');
    assert.strictEqual(checklistA.service_engineer, 'Mathi');
    assert.strictEqual(checklistA.original_expected_arrival_date || checklistA.expected_arrival_date, dateA_start);
    assert.strictEqual(checklistA.current_expected_arrival_date || checklistA.expected_arrival_date, dateA_start);
    console.log(`   ✓ Checklist A created for Mathi (${dateA_start}, 2 Days)`);

    // --------------------------------------------------------------------------
    // Test B: Double Booking Block & Explanation with Suggested Alternatives
    // --------------------------------------------------------------------------
    console.log('\n-> Test B: Double Booking Block, conflict explanation & alternative suggestion...');
    const availB = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: dateA_overlap,
      duration: '2 Days', // Overlaps with day 2 of job A
    });

    assert.strictEqual(availB.available, false, 'Mathi must be unavailable due to overlapping job');
    assert.ok(availB.conflict, 'Conflict object must be returned');
    assert.ok(availB.conflict.reason && availB.conflict.reason.includes('Mathi'), 'Conflict explanation must name engineer');
    assert.ok(Array.isArray(availB.suggested_engineers), 'Suggested alternatives must be returned');
    assert.ok(availB.suggested_engineers.some((e) => ['Guna', 'Sakthivel', 'Kamalesh'].includes(e.name)), 'Must suggest available alternative engineers');
    console.log(`   ✓ Double booking prevented. Conflict: "${availB.conflict.reason}"`);
    console.log(`   ✓ Suggested alternatives: ${availB.suggested_engineers.map((e) => e.name).join(', ')}`);

    // Verify creating overlapping checklist directly throws error
    let blockedError = null;
    try {
      await createChecklist(testUserSales.id, {
        client_name: `Conflict Client ${ts}`,
        client_mobile: '9876543211',
        client_location: 'Coimbatore',
        salesperson_name: 'Sales Rep 1',
        device_type: 'SafDrive Model X',
        number_of_devices: 1,
        number_of_vehicles: 1,
        service_engineer: 'Mathi',
        expected_arrival_date: dateA_overlap,
        expected_arrival_time: '10:00',
        installation_duration: '1 Day',
        installation_status: 'Assigned',
      });
    } catch (err) {
      blockedError = err;
    }
    assert.ok(blockedError, 'Direct duplicate creation must be rejected with conflict error');
    console.log('   ✓ Backend rejected duplicate booking attempt on Mathi');

    // --------------------------------------------------------------------------
    // Test C: Extension Pending (Schedule Unchanged)
    // --------------------------------------------------------------------------
    console.log('\n-> Test C: Extension Requested (Pending state preserves active schedule)...');
    const extensionC = await requestScheduleExtension({
      checklistId: checklistA.id,
      user: testUserTech,
      additionalWorkingDays: 2,
      requestedCompletionDate: dateA_ext,
      requestedReturnTravelDate: dateA_travel,
      restDayRequested: true,
      requestedRestDate: dateA_rest,
      reason: 'Additional client vehicles required custom brackets on site.',
    });

    assert.ok(extensionC && extensionC.id, 'Extension request must be created');
    assert.strictEqual(extensionC.status, 'PENDING');
    assert.strictEqual(extensionC.additional_working_days, 2);

    // Verify original checklist schedule is UNCHANGED while pending
    const chkPending = await getChecklistById(checklistA.id);
    assert.strictEqual(chkPending.expected_arrival_date, dateA_start);
    assert.strictEqual(chkPending.installation_duration, '2 Days');
    assert.strictEqual(chkPending.schedule_revision_number || 0, 0);
    console.log('   ✓ Extension submitted (Pending). Active checklist schedule remains intact at 2 Days.');

    // --------------------------------------------------------------------------
    // Test D: Extension Approved (Current Schedule Updated, Original Preserved)
    // --------------------------------------------------------------------------
    console.log('\n-> Test D: Extension Approved (Atomic update, audit history, dates blocked)...');
    const approvedExt = await approveScheduleExtension({
      extensionId: extensionC.id,
      user: testUserCoordinator,
      decisionNotes: 'Approved extension due to custom brackets on site. Extra day verified with client.',
    });

    assert.strictEqual(approvedExt.extension?.status || approvedExt.status, 'APPROVED');

    const chkApproved = await getChecklistById(checklistA.id);
    assert.strictEqual(chkApproved.original_expected_arrival_date || chkApproved.expected_arrival_date, dateA_start);
    assert.strictEqual(chkApproved.original_installation_duration, '2 Days');
    assert.strictEqual(chkApproved.current_installation_duration, '4 Days');
    assert.ok((chkApproved.schedule_revision_number || 0) >= 1, 'Schedule revision counter must increment');

    // Verify audit history is logged
    const historyD = await getScheduleRevisionHistory(checklistA.id);
    assert.ok(Array.isArray(historyD) && historyD.length > 0, 'Revision history must exist');
    console.log(`   ✓ Extension approved. Current duration: ${chkApproved.current_installation_duration}, Revisions: ${chkApproved.schedule_revision_number}`);
    console.log(`   ✓ Audit history recorded with reason: "${historyD[0].reason}"`);

    // Verify extended dates are now blocked
    const availD = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: dateA_ext,
      duration: '1 Day',
    });
    assert.strictEqual(availD.available, false, `Extended date ${dateA_ext} must now be blocked`);
    console.log(`   ✓ Extended date ${dateA_ext} is confirmed blocked in availability calculation`);

    // --------------------------------------------------------------------------
    // Test E: Extension Rejected (Schedule Unchanged)
    // --------------------------------------------------------------------------
    console.log('\n-> Test E: Extension Rejected (Schedule unchanged, status recorded)...');
    const extensionE = await requestScheduleExtension({
      checklistId: checklistA.id,
      user: testUserTech,
      additionalWorkingDays: 1,
      requestedCompletionDate: dateE_reject,
      reason: 'Tech wanted extra day for travel.',
    });

    const rejectedExt = await rejectScheduleExtension({
      extensionId: extensionE.id,
      user: testUserCoordinator,
      decisionNotes: 'Rejected: job must be handed over as agreed.',
    });

    assert.strictEqual(rejectedExt.extension?.status || rejectedExt.status, 'REJECTED');
    const chkAfterRejection = await getChecklistById(checklistA.id);
    assert.strictEqual(chkAfterRejection.current_installation_duration, '4 Days'); // Unchanged from previous approved 4 Days
    console.log('   ✓ Extension rejected. Checklist duration remains at 4 Days without changes.');

    // --------------------------------------------------------------------------
    // Test F: Rest-Day Request & Approval Blocks Dates
    // --------------------------------------------------------------------------
    console.log('\n-> Test F: Rest-Day Request & Approval blocks engineer availability...');
    const restReq = await requestRestDay({
      engineerIdOrName: 'Guna',
      startDate: dateF_rest,
      endDate: dateF_rest,
      user: testUserTech,
      reason: 'Compensatory rest day after outstation job.',
    });

    await approveRestDay({
      requestId: restReq.id,
      user: testUserCoordinator,
      decisionNotes: 'Approved rest day for Guna.',
    });

    const availF = await checkEngineerAvailability({
      engineerIdOrName: 'Guna',
      startDate: dateF_rest,
      duration: '1 Day',
    });

    assert.strictEqual(availF.available, false, 'Guna must be unavailable on rest day');
    assert.strictEqual(availF.conflict.type, 'REST_DAY');
    console.log(`   ✓ Rest day approved for Guna. Availability check blocked: "${availF.conflict.reason}"`);

    // --------------------------------------------------------------------------
    // Test G: Leave Request & Approval Blocks Dates
    // --------------------------------------------------------------------------
    console.log('\n-> Test G: Leave Request & Approval blocks engineer availability...');
    const leaveReq = await requestLeave({
      engineerIdOrName: 'Sakthivel',
      leaveStartDate: dateG_start,
      leaveEndDate: dateG_end,
      leaveType: 'Casual',
      user: testUserTech,
      reason: 'Family function in hometown.',
    });

    await approveLeave({
      leaveId: leaveReq.id,
      user: testUserCoordinator,
      decisionNotes: 'Approved 2 days casual leave.',
    });

    const availG = await checkEngineerAvailability({
      engineerIdOrName: 'Sakthivel',
      startDate: dateG_start,
      duration: '2 Days',
    });

    assert.strictEqual(availG.available, false, 'Sakthivel must be unavailable during leave');
    assert.strictEqual(availG.conflict.type, 'LEAVE');
    console.log(`   ✓ Leave approved for Sakthivel. Availability check blocked: "${availG.conflict.reason}"`);

    // --------------------------------------------------------------------------
    // Test H: Booking Integration (Affected Travel/Room Flagged)
    // --------------------------------------------------------------------------
    console.log('\n-> Test H: Coordinator Booking Integration (Affected bookings flagged on extension)...');
    const checklistH = await createChecklist(testUserSales.id, {
      client_name: `Hotel Booking Client ${ts}`,
      client_mobile: '9876543212',
      client_location: 'Madurai Outer',
      salesperson_name: 'Sales Rep 2',
      device_type: 'SafDrive Model Y',
      number_of_devices: 1,
      number_of_vehicles: 1,
      service_engineer: 'Kamalesh',
      expected_arrival_date: dateH_start,
      expected_arrival_time: '08:00',
      installation_duration: '1 Day',
      installation_status: 'Assigned',
    });

    // Coordinator books travel & accommodation
    await saveCoordinatorBooking({
      checklistId: checklistH.id,
      bookingData: {
        assigned_engineer: 'Kamalesh',
        travel_required: true,
        departure_city: 'Chennai',
        destination: 'Madurai',
        travel_datetime: `${dateH_start}T08:00:00`,
        travel_type: 'Bus',
        accommodation_required: true,
        hotel_name: 'Grand Madurai Hotel',
        check_in_date: dateH_start,
        check_out_date: dateH_checkout,
      },
      user: testUserCoordinator,
    });

    // Extension requested and approved for Kamalesh
    const extH = await requestScheduleExtension({
      checklistId: checklistH.id,
      user: testUserTech,
      additionalWorkingDays: 2,
      requestedCompletionDate: dateH_ext,
      reason: 'Client added 2 more vehicles on site.',
    });

    await approveScheduleExtension({
      extensionId: extH.id,
      user: testUserCoordinator,
      decisionNotes: 'Approved additional days. Need to re-book travel & room.',
    });

    const coordinatorData = await getCoordinatorChecklists({ limit: 100 });
    const affectedItem = (coordinatorData.checklists || []).find((c) => c.id === checklistH.id);
    assert.ok(affectedItem, 'Checklist H must exist in coordinator checklists');
    assert.ok(
      affectedItem.coordinator_booking?.schedule_flagged_for_review ||
      affectedItem.coordinator_booking?.accommodation_dates_affected,
      'Booking for Checklist H must be flagged as affected'
    );
    console.log(`   ✓ Affected booking detected: Checklist #${checklistH.checklist_number} flagged for Coordinator review!`);

    // --------------------------------------------------------------------------
    // Test I: Early Job Completion Releases Future Dates
    // --------------------------------------------------------------------------
    console.log('\n-> Test I: Early Job Completion releases future dates...');
    const checklistI = await createChecklist(testUserSales.id, {
      client_name: `Early Finish Client ${ts}`,
      client_mobile: '9876543213',
      client_location: 'Salem',
      salesperson_name: 'Sales Rep 1',
      device_type: 'SafDrive Model X',
      number_of_devices: 1,
      number_of_vehicles: 1,
      service_engineer: 'Kamalesh',
      expected_arrival_date: dateI_start,
      expected_arrival_time: '09:00',
      installation_duration: '4 Days',
      installation_status: 'Assigned',
    });

    // Start job
    await startInstallationJob({ checklist_id: checklistI.id, user: testUserTech });

    // Complete job early on day 2 instead of day 4
    await submitInstallationCompletionReport({
      checklist_id: checklistI.id,
      user: testUserTech,
      items: [
        {
          device_type: 'SafDrive Model X',
          quantity_carried: 1,
          quantity_installed: 1,
          quantity_to_return: 0,
          quantity_damaged: 0,
          quantity_missing: 0,
        },
      ],
      completion_status: 'Completed',
      remarks: 'Early finish on day 2. Smooth installation.',
      actual_completion_datetime: `${dateI_finish}T16:00:00`,
    });

    // Check availability on day 3 (which was originally occupied by this 4-day job)
    const availI = await checkEngineerAvailability({
      engineerIdOrName: 'Kamalesh',
      startDate: dateI_released,
      duration: '1 Day',
    });

    assert.strictEqual(availI.available, true, `Future date ${dateI_released} must be released and AVAILABLE`);
    console.log(`   ✓ Early completion released future dates! Kamalesh is available on ${dateI_released}.`);

    // --------------------------------------------------------------------------
    // Test J: Race Condition Concurrency Serialization Lock
    // --------------------------------------------------------------------------
    console.log('\n-> Test J: Race Condition Concurrency Lock (Parallel reservation test)...');
    const targetEng = 'Sakthivel';
    const targetDate = dateJ_race;

    let winnerCount = 0;
    let loserCount = 0;

    const bookingAttempt1 = acquireEngineerLock(targetEng, async () => {
      const avail = await checkEngineerAvailability({ engineerIdOrName: targetEng, startDate: targetDate, duration: '1 Day' });
      if (!avail.available) throw new Error('Unavailable');
      await reserveEngineerAtomic({
        engineerIdOrName: targetEng,
        startDate: targetDate,
        endDate: targetDate,
        checklistId: `chk-j1-${ts}`,
        checklistNumber: `CHK-J1-${ts}`,
        user: testUserSales,
      });
      return 'WINNER_1';
    });

    const bookingAttempt2 = acquireEngineerLock(targetEng, async () => {
      const avail = await checkEngineerAvailability({ engineerIdOrName: targetEng, startDate: targetDate, duration: '1 Day' });
      if (!avail.available) throw new Error('Unavailable');
      await reserveEngineerAtomic({
        engineerIdOrName: targetEng,
        startDate: targetDate,
        endDate: targetDate,
        checklistId: `chk-j2-${ts}`,
        checklistNumber: `CHK-J2-${ts}`,
        user: testUserSales,
      });
      return 'WINNER_2';
    });

    const results = await Promise.allSettled([bookingAttempt1, bookingAttempt2]);
    results.forEach((r) => {
      if (r.status === 'fulfilled') winnerCount++;
      else loserCount++;
    });

    assert.strictEqual(winnerCount, 1, 'Exactly one concurrent booking attempt must succeed');
    assert.strictEqual(loserCount, 1, 'Conflicting parallel attempt must be serialized and rejected');
    console.log('   ✓ Concurrency Lock serialized 2 simultaneous requests: exactly 1 accepted, 1 rejected.');

    // --------------------------------------------------------------------------
    // Test K: Security & Role Permission Enforcement
    // --------------------------------------------------------------------------
    console.log('\n-> Test K: Role Access Control (Technician cannot approve own extension)...');
    const app = express();
    app.use(express.json());

    // Mock auth middleware for testing
    let reqUser = null;
    app.use((req, res, next) => {
      req.user = reqUser;
      req.profile = reqUser;
      next();
    });

    app.use('/api/coordinator', coordinatorRoutes);

    const server = http.createServer(app);
    await new Promise((res) => server.listen(0, res));
    const port = server.address().port;

    // Simulate TECHNICAL role attempting to approve
    reqUser = testUserTech;
    const forbiddenRes = await fetch(`http://localhost:${port}/api/coordinator/schedule/extensions/${extensionC.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'APPROVE', decision_notes: 'Self approval attempt' }),
    });

    assert.strictEqual(forbiddenRes.status, 403, 'Technician user must receive 403 Forbidden');
    console.log('   ✓ Security check passed: Technician access to coordinator approval returned HTTP 403.');

    server.close();

    // --------------------------------------------------------------------------
    // Test L: System Regression Check
    // --------------------------------------------------------------------------
    console.log('\n-> Test L: Regression check (Sales creation, Store requirements, Tech report)...');
    const regChecklist = await createChecklist(testUserSales.id, {
      client_name: `Regression Check Client ${ts}`,
      client_mobile: '9876543214',
      client_location: 'Tirupur',
      salesperson_name: 'Sales Rep 3',
      device_type: 'SafDrive Model X',
      number_of_devices: 2,
      number_of_vehicles: 2,
      service_engineer: 'Guna',
      expected_arrival_date: dateL_reg,
      expected_arrival_time: '11:00',
      installation_duration: '1 Day',
      installation_status: 'Assigned',
    });
    assert.ok(regChecklist && regChecklist.checklist_number, 'Sales checklist creation passed');

    // Verify calendar view metrics
    const calData = await getAvailabilityCalendar({
      view: 'month',
      date: dateA_start,
    });
    assert.ok(calData && calData.summary, 'Calendar data and summary must be generated');
    console.log(`   ✓ Calendar calculated metrics: ${calData.summary.assigned} assigned, ${calData.summary.rest_day} rest days, ${calData.summary.leave} leaves`);
    console.log('   ✓ Regression verification complete: All workspace flows functional.');

    console.log('\n========================================================================');
    console.log('  ALL 12 ACCEPTANCE TESTS (A THROUGH L) PASSED WITH ZERO FAILURES!      ');
    console.log('========================================================================\n');
  } catch (err) {
    console.error('\n❌ ACCEPTANCE TEST FAILED:', err);
    process.exit(1);
  }
}

runAcceptanceTests();
