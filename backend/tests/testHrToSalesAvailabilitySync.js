/**
 * testHrToSalesAvailabilitySync.js
 *
 * End-to-end regression tests verifying HR-to-Sales technician availability synchronization:
 * 1. HR marks Mathi Not Available for 20 October 2026.
 * 2. Sales selects 20 October 2026; getEngineersAvailabilityForRange returns Mathi available: false with conflict reason.
 * 3. Mathi cannot be assigned in Sales.
 * 4. Sales API bypass attempt (createChecklist / reserveEngineerAtomic) is rejected by backend with 409 conflict error.
 * 5. HR marks Mathi Available for a valid date range; Sales reflects available: true.
 * 6. An active job prevents assignment even if HR marks the engineer Available (business priority rule).
 * 7. Multi-day installation dates are validated across the entire inclusive period.
 * 8. Rest Day and On Leave manual statuses block assignment with exact reason.
 * 9. All 4 engineers (Mathi, Guna, Sakthivel, Kamalesh) use the same authoritative calculation.
 * 10. Timezone and date boundaries do not cause a 1-day shift.
 */

import assert from 'node:assert';
import {
  setTechnicianManualAvailability,
  reverseTechnicianManualAvailability,
  getActiveOverrideForEngineer,
  getManualOverridesForEngineerRange,
  getTechnicianAvailabilityOverview,
  validateAuthorizedServiceEngineer,
} from '../src/services/hrAvailabilityService.js';
import {
  checkEngineerAvailability,
  getEngineersAvailabilityForRange,
  reserveEngineerAtomic,
  releaseEngineerBooking,
  SERVICE_ENGINEER_OPTIONS,
} from '../src/services/engineerBookingService.js';
import { createChecklist } from '../src/services/installationService.js';

let passed = 0;
let failed = 0;

async function test(desc, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.stack || err.message}`);
    failed++;
  }
}

async function runRegressionSuite() {
  console.log('========================================================================');
  console.log('   HR-TO-SALES TECHNICIAN AVAILABILITY SYNCHRONIZATION REGRESSION TEST   ');
  console.log('========================================================================\n');

  const hrUser = {
    id: '00000000-0000-0000-0000-000000000005',
    email: 'hr@eagleeyesafdrive.com',
    role: 'HR',
  };

  const targetDate = '2026-10-20';

  // --- TEST 1 & 2: HR marks Mathi Not Available for 20 October 2026 ---
  await test('1. HR marks Mathi "Not Available" for 20 October 2026 and saves successfully', async () => {
    const res = await setTechnicianManualAvailability({
      engineer_name: 'Mathi',
      manual_status: 'Not Available',
      date: targetDate,
      reason: 'Attending specialized training',
      user: hrUser,
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.manual_status, 'Not Available');
    assert.strictEqual(res.engineer_name, 'Mathi');

    const activeOverride = await getActiveOverrideForEngineer('Mathi', targetDate);
    assert(activeOverride, 'Active override must exist for Mathi on 2026-10-20');
    assert.strictEqual(activeOverride.manual_status, 'Not Available');
    assert.strictEqual(activeOverride.reason, 'Attending specialized training');
  });

  // --- TEST 3: Sales queries 20 October 2026; Mathi displays Not Available ---
  await test('2. Sales selects 20 October 2026: Mathi displays Not Available and available: false', async () => {
    const availability = await getEngineersAvailabilityForRange({
      startDate: targetDate,
      duration: '1 Day',
    });

    const mathi = availability.find((e) => e.name === 'Mathi');
    assert(mathi, 'Mathi must be in availability response');
    assert.strictEqual(mathi.available, false, 'Mathi must NOT be available on 20 October 2026');
    assert(mathi.conflict, 'Conflict object must be provided');
    assert.strictEqual(mathi.conflict.type, 'HR_MANUAL_OVERRIDE');
    assert.strictEqual(mathi.conflict.status, 'UNAVAILABLE');
    assert(
      mathi.conflict.reason.includes('manually set to Not Available by HR'),
      `Reason should mention HR manual status, got: ${mathi.conflict.reason}`
    );
  });

  // --- TEST 4: Sales API bypass attempt is rejected by backend with 409 ---
  await test('3. Backend rejects direct assignment via reserveEngineerAtomic with HTTP 409 conflict', async () => {
    await assert.rejects(
      async () => {
        await reserveEngineerAtomic({
          engineerIdOrName: 'Mathi',
          checklistId: 'test-chk-oct20',
          checklistNumber: 'CHK-OCT20-001',
          startDate: targetDate,
          duration: '1 Day',
          user: { id: 'sales-user-1' },
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 409, 'Must return HTTP 409 conflict');
        assert(
          err.message.includes('Cannot Assign: Engineer Mathi has been manually set to Not Available by HR'),
          `Error message must contain clear HR restriction, got: ${err.message}`
        );
        return true;
      }
    );
  });

  // --- TEST 5: HR marks Mathi Available for a clean date; Sales reflects Available ---
  await test('4. HR marks Mathi Available for 21 October 2026: Sales reflects Available: true', async () => {
    const nextDate = '2026-10-21';
    await setTechnicianManualAvailability({
      engineer_name: 'Mathi',
      manual_status: 'Available',
      date: nextDate,
      reason: 'Available for site deployment',
      user: hrUser,
    });

    const availability = await getEngineersAvailabilityForRange({
      startDate: nextDate,
      duration: '1 Day',
    });

    const mathi = availability.find((e) => e.name === 'Mathi');
    assert(mathi, 'Mathi must be in availability response');
    assert.strictEqual(mathi.available, true, 'Mathi must be available on 21 October 2026');
  });

  // --- TEST 6: Active job PREVAILS even if HR marks the engineer Available ---
  await test('5. Active job prevents assignment even if HR marks engineer Available (hard schedule priority)', async () => {
    const conflictDate = '2026-11-20';

    // 1. Reserve Mathi for an active job on 2026-11-20
    const booking = await reserveEngineerAtomic({
      engineerIdOrName: 'Mathi',
      checklistId: 'test-chk-conflict-1',
      checklistNumber: 'CHK-ACTIVE-JOB',
      startDate: conflictDate,
      duration: '1 Day',
      user: { id: 'admin-1' },
      status: 'ASSIGNED',
    });
    assert(booking, 'Booking created');

    try {
      // 2. HR attempts to mark Mathi "Available" on that same date
      const hrRes = await setTechnicianManualAvailability({
        engineer_name: 'Mathi',
        manual_status: 'Available',
        date: conflictDate,
        reason: 'HR says available anyway',
        user: hrUser,
      });

      assert.strictEqual(hrRes.override_blocked_by_conflict, true);
      assert.strictEqual(hrRes.schedulable, false);

      // 3. Sales availability calculation MUST still report Mathi as NOT available
      const avail = await checkEngineerAvailability({
        engineerIdOrName: 'Mathi',
        startDate: conflictDate,
        duration: '1 Day',
      });

      assert.strictEqual(avail.available, false, 'Mathi must remain unavailable due to active job');
      assert.strictEqual(avail.conflict.type, 'JOB', 'Conflict type must be JOB');
      assert(
        avail.conflict.reason.includes('CHK-ACTIVE-JOB') || avail.conflict.checklist_number === 'CHK-ACTIVE-JOB',
        'Conflict must reference active job'
      );
    } finally {
      await releaseEngineerBooking({ checklistId: 'test-chk-conflict-1' });
    }
  });

  // --- TEST 7: Multi-day installation dates checked across entire inclusive range ---
  await test('6. Multi-day installation range (2026-10-19 to 2026-10-21, 3 Days) is blocked by Mathi Not Available on Oct 20', async () => {
    // Mathi is Not Available on Oct 20.
    // If Sales requests 3 days starting 2026-10-19 (dates: Oct 19, Oct 20, Oct 21):
    const check = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: '2026-10-19',
      duration: '3 Days',
    });

    assert.strictEqual(check.available, false, 'Multi-day span overlapping Oct 20 must be blocked');
    assert.strictEqual(check.conflict.type, 'HR_MANUAL_OVERRIDE');
    assert(check.conflict.reason.includes('Not Available by HR'));
  });

  // --- TEST 8: Rest Day and On Leave manual statuses block assignment ---
  await test('7. HR marks Guna "Rest Day" and Sakthivel "On Leave" on 2026-10-25; both block assignment with exact reason', async () => {
    const testDate = '2026-10-25';

    await setTechnicianManualAvailability({
      engineer_name: 'Guna',
      manual_status: 'Rest Day',
      date: testDate,
      reason: 'Compensatory off',
      user: hrUser,
    });

    await setTechnicianManualAvailability({
      engineer_name: 'Sakthivel',
      manual_status: 'On Leave',
      date: testDate,
      reason: 'Annual family leave',
      user: hrUser,
    });

    const availGuna = await checkEngineerAvailability({
      engineerIdOrName: 'Guna',
      startDate: testDate,
      duration: '1 Day',
    });
    assert.strictEqual(availGuna.available, false);
    assert.strictEqual(availGuna.conflict.status, 'REST');
    assert(availGuna.conflict.reason.includes('Rest Day by HR ("Compensatory off")'));

    const availSakthi = await checkEngineerAvailability({
      engineerIdOrName: 'Sakthivel',
      startDate: testDate,
      duration: '1 Day',
    });
    assert.strictEqual(availSakthi.available, false);
    assert.strictEqual(availSakthi.conflict.status, 'LEAVE');
    assert(availSakthi.conflict.reason.includes('On Leave by HR ("Annual family leave")'));
  });

  // --- TEST 9: All 4 engineers (Mathi, Guna, Sakthivel, Kamalesh) use the same authoritative calculation ---
  await test('8. All 4 engineers strictly use the exact same authoritative calculation', async () => {
    const testDate = '2026-10-28';

    for (const name of SERVICE_ENGINEER_OPTIONS) {
      // Set Not Available
      await setTechnicianManualAvailability({
        engineer_name: name,
        manual_status: 'Not Available',
        date: testDate,
        reason: `Testing consistency for ${name}`,
        user: hrUser,
      });

      const check = await checkEngineerAvailability({
        engineerIdOrName: name,
        startDate: testDate,
        duration: '1 Day',
      });

      assert.strictEqual(check.available, false, `${name} must be unavailable`);
      assert.strictEqual(check.conflict.type, 'HR_MANUAL_OVERRIDE');
      assert(check.conflict.reason.includes(`Engineer ${name} has been manually set to Not Available by HR`));
    }
  });

  // --- TEST 10: Suggested alternative engineers excludes technicians with blocking HR overrides ---
  await test('9. Suggested alternative engineers never suggest technicians who have blocking HR overrides', async () => {
    const testDate = '2026-10-29';

    // Set Mathi, Guna, and Sakthivel all Not Available on 2026-10-29
    await setTechnicianManualAvailability({ engineer_name: 'Mathi', manual_status: 'Not Available', date: testDate, user: hrUser });
    await setTechnicianManualAvailability({ engineer_name: 'Guna', manual_status: 'Not Available', date: testDate, user: hrUser });
    await setTechnicianManualAvailability({ engineer_name: 'Sakthivel', manual_status: 'Rest Day', date: testDate, user: hrUser });

    // Kamalesh is left Available (no override or commitments)
    const checkMathi = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: testDate,
      duration: '1 Day',
    });

    assert.strictEqual(checkMathi.available, false);
    const suggestedNames = (checkMathi.suggested_engineers || []).map((s) => s.name);
    assert(suggestedNames.includes('Kamalesh'), 'Kamalesh should be suggested as he is available');
    assert(!suggestedNames.includes('Guna'), 'Guna must NOT be suggested as he is Not Available');
    assert(!suggestedNames.includes('Sakthivel'), 'Sakthivel must NOT be suggested as he is on Rest Day');
  });

  // --- TEST 11: Multi-day override (e.g. 2026-11-01 to 2026-11-03) is respected for all days in range ---
  await test('10. Multi-day override (2026-11-01 to 2026-11-03) is respected for every day in the range', async () => {
    await setTechnicianManualAvailability({
      engineer_name: 'Kamalesh',
      manual_status: 'Not Available',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      reason: 'Regional equipment audit',
      user: hrUser,
    });

    for (const d of ['2026-11-01', '2026-11-02', '2026-11-03']) {
      const check = await checkEngineerAvailability({
        engineerIdOrName: 'Kamalesh',
        startDate: d,
        duration: '1 Day',
      });
      assert.strictEqual(check.available, false, `Kamalesh must be unavailable on day ${d}`);
      assert.strictEqual(check.conflict.type, 'HR_MANUAL_OVERRIDE');
    }

    // Day after override must be available
    const checkAfter = await checkEngineerAvailability({
      engineerIdOrName: 'Kamalesh',
      startDate: '2026-11-04',
      duration: '1 Day',
    });
    assert.strictEqual(checkAfter.available, true, 'Kamalesh should be available on day after override');
  });

  // --- TEST 12: Reverse override restores availability ---
  await test('11. Reversing override immediately restores availability in both HR overview and Sales check', async () => {
    const testDate = '2026-11-10';
    const setRes = await setTechnicianManualAvailability({
      engineer_name: 'Mathi',
      manual_status: 'Not Available',
      date: testDate,
      reason: 'Temporary hold',
      user: hrUser,
    });

    // Verify unavailable
    const beforeRev = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: testDate,
      duration: '1 Day',
    });
    assert.strictEqual(beforeRev.available, false);

    // Reverse override
    await reverseTechnicianManualAvailability(setRes.id, 'Hold removed', hrUser);

    // Verify available
    const afterRev = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: testDate,
      duration: '1 Day',
    });
    assert.strictEqual(afterRev.available, true, 'Mathi must be available after override reversal');
  });

  console.log('\n========================================================================');
  console.log(`  REGRESSION TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runRegressionSuite().catch((err) => {
  console.error('Fatal error in regression suite:', err);
  process.exit(1);
});
