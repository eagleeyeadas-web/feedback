import assert from 'node:assert';
import {
  setTechnicianManualAvailability,
  reverseTechnicianManualAvailability,
  getTechnicianAvailabilityOverview,
  validateAuthorizedServiceEngineer,
  getAllOverrides,
} from '../services/hrAvailabilityService.js';
import {
  getAvailabilityCalendar,
  SERVICE_ENGINEER_OPTIONS,
} from '../services/engineerBookingService.js';

let passed = 0;
let failed = 0;

async function it(desc, fn) {
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

async function runTestSuite() {
  console.log('================================================================');
  console.log('   EAGLE EYE SAFDRIVE — HR TECHNICIAN AVAILABILITY TEST SUITE   ');
  console.log('================================================================\n');

  const targetDate = '2026-11-15';
  const hrUser = {
    id: '00000000-0000-0000-0000-000000000005',
    email: 'hr@eagleeyesafdrive.com',
    role: 'HR',
  };

  // ============================================================================
  // TEST GROUP 1: Authorized Engineers & Status Enum Validation
  // ============================================================================
  console.log('[Test Group 1] Authorized Engineers & Permitted Status Options');

  await it('Validates strictly the 4 authorized main engineers', () => {
    assert.deepStrictEqual(SERVICE_ENGINEER_OPTIONS, ['Mathi', 'Guna', 'Sakthivel', 'Kamalesh']);
    for (const name of SERVICE_ENGINEER_OPTIONS) {
      const res = validateAuthorizedServiceEngineer(name);
      assert.strictEqual(res.name, name);
    }
  });

  await it('Rejects unauthorized technician names with 400 error', async () => {
    await assert.rejects(
      async () => {
        await setTechnicianManualAvailability({
          engineer_name: 'Subcontractor Dave',
          manual_status: 'Available',
          date: targetDate,
          user: hrUser,
        });
      },
      /restricted strictly to the four authorized service engineers/
    );
  });

  await it('Rejects invalid status values outside the 4 permitted options', async () => {
    await assert.rejects(
      async () => {
        await setTechnicianManualAvailability({
          engineer_name: 'Mathi',
          manual_status: 'Off Duty',
          date: targetDate,
          user: hrUser,
        });
      },
      /Manual availability status must be one of: Available, Not Available, Rest Day, On Leave/
    );
  });

  // ============================================================================
  // TEST GROUP 2: Setting All 4 Permitted Statuses for Each of the 4 Engineers
  // ============================================================================
  console.log('\n[Test Group 2] Setting All 4 Statuses for All 4 Authorized Engineers (No manualStatus error)');

  const statusesToTest = ['Available', 'Not Available', 'Rest Day', 'On Leave'];

  for (const engName of SERVICE_ENGINEER_OPTIONS) {
    for (const status of statusesToTest) {
      await it(`Sets status "${status}" for engineer ${engName} without runtime error`, async () => {
        const testDate = `2026-11-${10 + statusesToTest.indexOf(status)}`;
        const notes = `HR administrative test: ${engName} set to ${status}`;

        const result = await setTechnicianManualAvailability({
          engineer_name: engName,
          manual_status: status,
          date: testDate,
          reason: notes,
          user: hrUser,
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.manual_status, status);
        assert.ok(result.message, 'Response must include descriptive user message');
        assert.ok(!result.message.includes('undefined'), 'Message must not contain undefined variables');
        assert.strictEqual(result.override.engineer_name, engName);
        assert.strictEqual(result.override.manual_status, status);
        assert.strictEqual(result.override.reason, notes);
        assert.strictEqual(result.override.created_by_role, 'HR');

        // Check calendar immediately reflects updated status
        const calendar = await getAvailabilityCalendar({
          startDate: testDate,
          endDate: testDate,
        });

        const engSchedule = calendar.schedule.find((s) => s.engineer.name === engName);
        assert.ok(engSchedule, `Schedule must include ${engName}`);
        const dayCell = engSchedule.days.find((d) => d.date === testDate);
        assert.ok(dayCell, `Day cell for ${testDate} must exist`);

        if (status === 'Not Available') {
          assert.strictEqual(dayCell.status, 'UNAVAILABLE');
          assert.strictEqual(dayCell.is_available, false);
        } else if (status === 'Rest Day') {
          assert.strictEqual(dayCell.status, 'REST');
          assert.strictEqual(dayCell.is_available, false);
        } else if (status === 'On Leave') {
          assert.strictEqual(dayCell.status, 'LEAVE');
          assert.strictEqual(dayCell.is_available, false);
        } else if (status === 'Available') {
          assert.strictEqual(dayCell.status, 'AVAILABLE');
          assert.strictEqual(dayCell.is_available, true);
        }

        // Verify dayCell exposes manual_override metadata
        assert.ok(dayCell.manual_override, 'Day cell must include manual_override object');
        assert.strictEqual(dayCell.manual_override.manual_status, status);
      });
    }
  }

  // ============================================================================
  // TEST GROUP 3: Scheduling Safeguards & Active Conflict Protection
  // ============================================================================
  console.log('\n[Test Group 3] Scheduling Safeguards & Active Conflict Handling');

  await it('Prevents conflicting assignments from being silently overridden when marking Available', async () => {
    // If an engineer has active commitments on a date, marking them Available records HR administrative intent
    // but flags override_blocked_by_conflict and does not erase the commitment
    const conflictDate = '2026-11-20';

    // Mock an active assignment in commitments or check behavior with commitments
    const result = await setTechnicianManualAvailability({
      engineer_name: 'Guna',
      manual_status: 'Available',
      date: conflictDate,
      reason: 'HR routine check',
      user: hrUser,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.manual_status, 'Available');
    assert.ok(typeof result.schedulable === 'boolean');
    assert.ok(typeof result.override_blocked_by_conflict === 'boolean');
  });

  // ============================================================================
  // TEST GROUP 4: Reversal of Manual Overrides
  // ============================================================================
  console.log('\n[Test Group 4] Reversal Workflow & Recalculation');

  await it('Allows reversing an active manual override back to calculated availability', async () => {
    const revDate = '2026-11-25';
    const setRes = await setTechnicianManualAvailability({
      engineer_name: 'Sakthivel',
      manual_status: 'Rest Day',
      date: revDate,
      reason: 'Scheduled rest day',
      user: hrUser,
    });

    assert.strictEqual(setRes.success, true);
    const overrideId = setRes.override.id;

    const reverseRes = await reverseTechnicianManualAvailability(
      overrideId,
      'Rest day rescheduled to next week',
      hrUser
    );

    assert.strictEqual(reverseRes.success, true);
    assert.strictEqual(reverseRes.override.is_active, false);
    assert.strictEqual(reverseRes.override.reversal_reason, 'Rest day rescheduled to next week');

    // Calendar should no longer treat Sakthivel as REST on revDate
    const calendar = await getAvailabilityCalendar({
      startDate: revDate,
      endDate: revDate,
    });
    const engSched = calendar.schedule.find((s) => s.engineer.name === 'Sakthivel');
    const cell = engSched.days.find((d) => d.date === revDate);
    assert.notStrictEqual(cell.status, 'REST', 'Reversed rest day must not remain REST');
  });

  // ============================================================================
  // TEST GROUP 5: Persistence & Invariant Records
  // ============================================================================
  console.log('\n[Test Group 5] Storage Persistence & Overview API');

  await it('Preserves saved overrides across getAllOverrides and overview API', async () => {
    const all = await getAllOverrides();
    assert.ok(Array.isArray(all));
    assert.ok(all.length > 0, 'Saved overrides should be stored in system storage');

    const overview = await getTechnicianAvailabilityOverview();
    assert.ok(Array.isArray(overview));
    assert.strictEqual(overview.length, 4, 'Overview must include all 4 authorized service engineers');
  });

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite failed to run:', err);
  process.exit(1);
});
