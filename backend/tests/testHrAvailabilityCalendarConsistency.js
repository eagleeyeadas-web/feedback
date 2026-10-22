/**
 * Comprehensive Test Suite: HR Workspace Availability Calendar Consistency & Orphaned Commitments
 * Tests all 4 authorized service engineers: Mathi, Guna, Sakthivel, Kamalesh
 * 
 * Verifies the 10 required business rules:
 * 1. Delete a test checklist with an invalid dependent commitment; verify the commitment no longer blocks availability.
 * 2. Keep a valid independent travel commitment; verify it still blocks conflicting assignments.
 * 3. Cancel an assignment; verify availability recalculates correctly.
 * 4. Preserve an active assignment; verify the engineer is not incorrectly marked Available.
 * 5. Approve an extension; verify the engineer remains unavailable for the extended period.
 * 6. Expire a temporary HR override; verify it no longer affects future dates.
 * 7. Preserve legitimate rest-day and leave restrictions.
 * 8. Refresh and re-login; verify no stale status returns.
 * 9. Verify HR and Coordinator views agree where they share availability data.
 * 10. Attempt a conflicting assignment; verify backend validation rejects it with a meaningful explanation.
 */

import { v4 as uuidv4 } from 'uuid';
import assert from 'assert';
import supabase from '../src/services/supabase.js';
import {
  getAvailabilityCalendar,
  checkEngineerAvailability,
  getEngineerCommitments,
  deleteEngineerBookingForChecklist,
  reconcileEngineerBookings,
  resolveEngineer,
} from '../src/services/engineerBookingService.js';
import {
  inMemoryBookings as coordInMemoryBookings,
  deleteCoordinatorBookingForChecklist,
  reconcileCoordinatorBookings,
} from '../src/services/coordinatorBookingService.js';
import {
  setTechnicianManualAvailability,
  reverseTechnicianManualAvailability,
} from '../src/services/hrAvailabilityService.js';
import {
  createChecklist,
  safeDeleteChecklist,
  cancelChecklist,
} from '../src/services/installationService.js';
import {
  approveScheduleExtension,
  requestScheduleExtension,
} from '../src/services/scheduleExtensionService.js';

const DUMMY_USER = {
  id: 'e1000000-0000-0000-0000-000000000001',
  email: 'hr.test@eagleeyesafdrive.com',
  role: 'HR',
};

async function createTestChecklist({ clientName, serviceEngineer, date, duration = '1 Day' }) {
  return await createChecklist(DUMMY_USER.id, {
    client_name: clientName,
    client_mobile: '9876543210',
    client_location: 'Central Distribution Hub, Chennai',
    service_engineer: serviceEngineer,
    expected_arrival_date: date,
    installation_duration: duration,
    installation_status: 'Assigned',
    delivery_method: 'Technician Carries',
    device_type: '2 Channel Live',
    number_of_devices: 1,
    number_of_vehicles: 1,
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  STARTING TEST SUITE: HR Availability Calendar Consistency');
  console.log('  Testing 4 Engineers: Mathi, Guna, Sakthivel, Kamalesh');
  console.log('================================================================\n');

  let passedTests = 0;
  let failedTests = 0;

  async function testCase(name, fn) {
    try {
      console.log(`[TEST RUNNING] ${name}`);
      await fn();
      console.log(`[PASS] ${name}\n`);
      passedTests++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(err);
      console.log('');
      failedTests++;
    }
  }

  // Cleanup lingering test checklists from any previous aborted runs
  try {
    const { data: lingering } = await supabase
      .from('installation_checklists')
      .select('id, client_name')
      .or('client_name.ilike.Test Client Case%,client_name.ilike.Existing Client Ltd%');
    if (lingering && lingering.length > 0) {
      for (const row of lingering) {
        await safeDeleteChecklist(row.id, DUMMY_USER);
      }
    }
  } catch (e) {}

  // TEST 1: Delete a test checklist with an invalid dependent commitment; verify it no longer blocks
  await testCase('1. Delete test checklist with invalid dependent commitment -> unblocks availability', async () => {
    const testDate = '2026-11-15';
    const testEngineer = 'Mathi';

    // 1. Create temporary checklist
    const chk = await createTestChecklist({
      clientName: 'Test Client Case 1',
      serviceEngineer: testEngineer,
      date: testDate,
    });

    // 2. Insert dependent pending travel commitment (no confirmed ticket)
    const travelBookingId = uuidv4();
    coordInMemoryBookings.set(chk.id, {
      id: travelBookingId,
      checklist_id: chk.id,
      assigned_engineer: testEngineer,
      outbound_status: 'Pending',
      outbound_departure_datetime: `${testDate}T08:00:00.000Z`,
      outbound_destination: 'Test Destination',
      outbound_ticket_reference: null,
      created_at: new Date().toISOString(),
    });

    // Verify engineer is currently assigned or traveling (not available)
    const calBefore = await getAvailabilityCalendar({ startDate: testDate, endDate: testDate, engineerId: testEngineer });
    const dayBefore = calBefore.schedule[0].days[0];
    assert.strictEqual(dayBefore.is_available, false, 'Expected engineer to be unavailable before deletion');

    // 3. Delete the checklist
    await safeDeleteChecklist(chk.id, DUMMY_USER);

    // 4. Verify engineer is immediately Available and dependent commitment is gone
    const calAfter = await getAvailabilityCalendar({ startDate: testDate, endDate: testDate, engineerId: testEngineer });
    const dayAfter = calAfter.schedule[0].days[0];
    assert.strictEqual(dayAfter.status, 'AVAILABLE', `Expected status to be AVAILABLE after deletion, got ${dayAfter.status}`);
    assert.strictEqual(dayAfter.is_available, true);
    assert.strictEqual(dayAfter.commitment, null);
  });

  // TEST 2: Keep a valid independent travel commitment; verify it still blocks conflicting assignments
  await testCase('2. Valid independent travel commitment -> remains active and blocks assignments', async () => {
    const testDate = '2026-11-16';
    const testEngineer = 'Sakthivel';
    const independentTravelId = uuidv4();

    // Insert an independent travel booking with confirmed ticket
    coordInMemoryBookings.set(independentTravelId, {
      id: independentTravelId,
      checklist_id: null, // independent: no parent checklist
      assigned_engineer: testEngineer,
      outbound_status: 'Confirmed',
      outbound_departure_datetime: `${testDate}T09:00:00.000Z`,
      outbound_destination: 'Coimbatore Hub',
      outbound_ticket_reference: 'SETC-CONFIRMED-999',
      ticket_reference: 'SETC-CONFIRMED-999',
      created_at: new Date().toISOString(),
    });

    try {
      // 1. Verify calendar shows Traveling
      const cal = await getAvailabilityCalendar({ startDate: testDate, endDate: testDate, engineerId: testEngineer });
      const day = cal.schedule[0].days[0];
      assert.strictEqual(day.status, 'TRAVEL', `Expected status TRAVEL, got ${day.status}`);
      assert.strictEqual(day.is_available, false);

      // 2. Verify assignment attempt on that date is blocked
      const availCheck = await checkEngineerAvailability({
        engineerIdOrName: testEngineer,
        startDate: testDate,
        endDate: testDate,
      });
      assert.strictEqual(availCheck.available, false, 'Expected availability check to be blocked by confirmed travel');
      assert(availCheck.conflict.reason.includes('travel commitment'), 'Expected conflict reason to mention travel');
    } finally {
      // Cleanup
      coordInMemoryBookings.delete(independentTravelId);
    }
  });

  // TEST 3: Cancel an assignment; verify availability recalculates correctly
  await testCase('3. Cancel an assignment -> availability recalculates to AVAILABLE', async () => {
    const testDate = '2026-11-17';
    const testEngineer = 'Guna';

    // 1. Create checklist and assignment
    const chk = await createTestChecklist({
      clientName: 'Test Client Case 3',
      serviceEngineer: testEngineer,
      date: testDate,
    });

    try {
      // Verify currently Assigned
      const calBefore = await getAvailabilityCalendar({ startDate: testDate, endDate: testDate, engineerId: testEngineer });
      const dayBefore = calBefore.schedule[0].days[0];
      assert.strictEqual(dayBefore.status, 'ASSIGNED');
      assert.strictEqual(dayBefore.is_available, false);

      // 2. Cancel the assignment
      await cancelChecklist({ checklistId: chk.id, user: DUMMY_USER, reason: 'Client requested cancellation' });

      // 3. Verify availability recalculates to AVAILABLE
      const calAfter = await getAvailabilityCalendar({ startDate: testDate, endDate: testDate, engineerId: testEngineer });
      const dayAfter = calAfter.schedule[0].days[0];
      assert.strictEqual(dayAfter.status, 'AVAILABLE', `Expected status AVAILABLE after cancellation, got ${dayAfter.status}`);
      assert.strictEqual(dayAfter.is_available, true);
    } finally {
      // Cleanup
      await safeDeleteChecklist(chk.id, DUMMY_USER);
    }
  });

  // TEST 4: Preserve an active assignment; verify the engineer is not incorrectly marked Available
  await testCase('4. Active assignment prevails -> HR Available override is blocked by conflict', async () => {
    const testDate = '2026-11-18';
    const testEngineer = 'Kamalesh';

    // 1. Create active assignment
    const chk = await createTestChecklist({
      clientName: 'Test Client Case 4',
      serviceEngineer: testEngineer,
      date: testDate,
    });

    let overrideRes = null;
    try {
      // 2. HR attempts to set manual status to "Available"
      overrideRes = await setTechnicianManualAvailability({
        engineerIdOrName: testEngineer,
        manualStatus: 'Available',
        date: testDate,
        reason: 'HR attempt override on active assignment',
        user: DUMMY_USER,
      });

      // Verify that override reports conflict and does NOT make technician schedulable
      assert.strictEqual(overrideRes.override_blocked_by_conflict, true);
      assert.strictEqual(overrideRes.schedulable, false);

      // Verify calendar still preserves active assignment status
      const cal = await getAvailabilityCalendar({ startDate: testDate, endDate: testDate, engineerId: testEngineer });
      const day = cal.schedule[0].days[0];
      assert.strictEqual(day.status, 'ASSIGNED', 'Active assignment must prevail over HR Available override');
      assert.strictEqual(day.is_available, false);
      assert(day.warning || day.commitment, 'Expected active commitment warning');
    } finally {
      // Cleanup
      if (overrideRes?.id) {
        await reverseTechnicianManualAvailability(overrideRes.id, 'Clean test', DUMMY_USER);
      }
      await safeDeleteChecklist(chk.id, DUMMY_USER);
    }
  });

  // TEST 5: Approve an extension; verify the engineer remains unavailable for the extended period
  await testCase('5. Approve extension -> engineer remains unavailable through revised completion date', async () => {
    const startDate = '2026-11-19';
    const originalEnd = '2026-11-19';
    const extendedEnd = '2026-11-20';
    const testEngineer = 'Mathi';

    // 1. Create installation checklist
    const chk = await createTestChecklist({
      clientName: 'Test Client Case 5',
      serviceEngineer: testEngineer,
      date: startDate,
    });

    let ext = null;
    try {
      // 2. Request extension
      ext = await requestScheduleExtension({
        checklistId: chk.id,
        user: DUMMY_USER,
        requestedCompletionDate: extendedEnd,
        reason: 'Site cabling delay',
      });

      // 3. Approve extension
      await approveScheduleExtension({
        extensionId: ext.id,
        user: DUMMY_USER,
        decisionNotes: 'Approved site delay',
      });

      // 4. Verify engineer is unavailable on the extended date (2026-11-20)
      const cal = await getAvailabilityCalendar({ startDate: extendedEnd, endDate: extendedEnd, engineerId: testEngineer });
      const day = cal.schedule[0].days[0];
      assert.strictEqual(day.is_available, false, 'Expected engineer to remain unavailable on extended date');
    } finally {
      // Cleanup
      if (ext?.id) {
        await supabase.from('schedule_extension_requests').delete().eq('id', ext.id);
      }
      await safeDeleteChecklist(chk.id, DUMMY_USER);
    }
  });

  // TEST 6: Expire a temporary HR override; verify it no longer affects future dates
  await testCase('6. Expire/Single-date HR override -> does not affect subsequent dates', async () => {
    const overrideDate = '2026-11-21';
    const nextDate = '2026-11-22';
    const testEngineer = 'Guna';

    // 1. Set 1-day override to Not Available
    const overrideRes = await setTechnicianManualAvailability({
      engineerIdOrName: testEngineer,
      manualStatus: 'Not Available',
      date: overrideDate,
      reason: 'Personal leave approved by HR',
      user: DUMMY_USER,
    });

    try {
      // 2. Verify override date is UNAVAILABLE
      const cal1 = await getAvailabilityCalendar({ startDate: overrideDate, endDate: overrideDate, engineerId: testEngineer });
      assert.strictEqual(cal1.schedule[0].days[0].status, 'UNAVAILABLE');
      assert.strictEqual(cal1.schedule[0].days[0].is_available, false);

      // 3. Verify subsequent date is AVAILABLE
      const cal2 = await getAvailabilityCalendar({ startDate: nextDate, endDate: nextDate, engineerId: testEngineer });
      assert.strictEqual(cal2.schedule[0].days[0].status, 'AVAILABLE', 'Expected subsequent date to be AVAILABLE');
      assert.strictEqual(cal2.schedule[0].days[0].is_available, true);
    } finally {
      if (overrideRes?.id) {
        await reverseTechnicianManualAvailability(overrideRes.id, 'Clean test', DUMMY_USER);
      }
    }
  });

  // TEST 7: Preserve legitimate rest-day and leave restrictions
  await testCase('7. Legitimate rest-day and leave -> block conflicting assignments', async () => {
    const leaveDate = '2026-11-23';
    const restDate = '2026-11-24';
    const leaveEng = 'Sakthivel';
    const restEng = 'Kamalesh';

    const leaveId = uuidv4();
    const restId = uuidv4();
    const resolvedLeaveEng = resolveEngineer(leaveEng);
    const resolvedRestEng = resolveEngineer(restEng);

    // 1. Insert approved leave
    await supabase.from('leave_requests').insert([{
      id: leaveId,
      engineer_id: resolvedLeaveEng.id,
      engineer_name: leaveEng,
      leave_type: 'Sick Leave',
      leave_start_date: leaveDate,
      leave_end_date: leaveDate,
      status: 'APPROVED',
      reason: 'Medical checkup',
    }]);

    // 2. Insert approved rest day
    await supabase.from('rest_day_requests').insert([{
      id: restId,
      engineer_id: resolvedRestEng.id,
      engineer_name: restEng,
      rest_start_date: restDate,
      rest_end_date: restDate,
      status: 'APPROVED',
      reason: 'Post installation compensatory off',
    }]);

    try {
      // Verify leave displays in calendar
      const calLeave = await getAvailabilityCalendar({ startDate: leaveDate, endDate: leaveDate, engineerId: leaveEng });
      assert.strictEqual(calLeave.schedule[0].days[0].status, 'LEAVE');
      assert.strictEqual(calLeave.schedule[0].days[0].is_available, false);

      // Verify rest day displays in calendar
      const calRest = await getAvailabilityCalendar({ startDate: restDate, endDate: restDate, engineerId: restEng });
      assert.strictEqual(calRest.schedule[0].days[0].status, 'REST');
      assert.strictEqual(calRest.schedule[0].days[0].is_available, false);

      // Verify assignment conflicts are blocked
      const leaveConflict = await checkEngineerAvailability({ engineerIdOrName: leaveEng, startDate: leaveDate });
      assert.strictEqual(leaveConflict.available, false);
      assert(leaveConflict.conflict.reason.includes('Leave'));

      const restConflict = await checkEngineerAvailability({ engineerIdOrName: restEng, startDate: restDate });
      assert.strictEqual(restConflict.available, false);
      assert(restConflict.conflict.reason.includes('Rest Day'));
    } finally {
      await supabase.from('leave_requests').delete().eq('id', leaveId);
      await supabase.from('rest_day_requests').delete().eq('id', restId);
    }
  });

  // TEST 8: Refresh and re-login; verify no stale status returns
  await testCase('8. Refresh persistence -> authoritative backend returns consistent fresh state', async () => {
    const testDate = '2026-11-25';
    // Query consecutive times to confirm determinism
    const run1 = await getAvailabilityCalendar({ startDate: testDate, endDate: testDate });
    const run2 = await getAvailabilityCalendar({ startDate: testDate, endDate: testDate });

    assert.strictEqual(run1.schedule.length, 4, 'Expected all 4 service engineers in schedule');
    assert.strictEqual(run2.schedule.length, 4, 'Expected all 4 service engineers in schedule');

    for (let i = 0; i < 4; i++) {
      assert.strictEqual(run1.schedule[i].days[0].status, run2.schedule[i].days[0].status);
      assert.strictEqual(run1.schedule[i].days[0].is_available, run2.schedule[i].days[0].is_available);
    }
  });

  // TEST 9: Verify HR and Coordinator views agree where they share availability data
  await testCase('9. View consistency -> HR Calendar and Coordinator Availability agree', async () => {
    const testDate = '2026-11-26';
    const engineers = ['Mathi', 'Guna', 'Sakthivel', 'Kamalesh'];

    const hrCalendar = await getAvailabilityCalendar({ startDate: testDate, endDate: testDate });

    for (const engName of engineers) {
      const hrEngDay = hrCalendar.schedule.find((s) => s.engineer.name === engName).days[0];
      const coordCheck = await checkEngineerAvailability({
        engineerIdOrName: engName,
        startDate: testDate,
        endDate: testDate,
      });

      assert.strictEqual(
        hrEngDay.is_available,
        coordCheck.available,
        `Discrepancy for ${engName} on ${testDate}: HR=${hrEngDay.is_available}, Coordinator=${coordCheck.available}`
      );
    }
  });

  // TEST 10: Attempt a conflicting assignment; verify backend validation rejects with meaningful explanation
  await testCase('10. Conflicting assignment -> rejected with clear conflict details & suggestions', async () => {
    const testDate = '2026-11-27';
    const targetEng = 'Kamalesh';

    // 1. Create existing booking
    const chk = await createTestChecklist({
      clientName: 'Existing Client Ltd',
      serviceEngineer: targetEng,
      date: testDate,
    });

    try {
      // 2. Attempt conflicting assignment
      const availCheck = await checkEngineerAvailability({
        engineerIdOrName: targetEng,
        startDate: testDate,
        endDate: testDate,
      });

      assert.strictEqual(availCheck.available, false, 'Expected availability check to fail on conflict');
      assert(availCheck.conflict, 'Expected conflict object');
      assert(availCheck.conflict.reason.includes(targetEng) || availCheck.conflict.reason.includes(chk.checklist_number));
      assert(Array.isArray(availCheck.suggested_engineers), 'Expected suggested engineers list');
      assert(availCheck.suggested_engineers.length > 0, 'Expected alternative engineers suggested');
    } finally {
      await safeDeleteChecklist(chk.id, DUMMY_USER);
    }
  });

  console.log('================================================================');
  console.log(`  TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
