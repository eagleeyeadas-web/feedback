import assert from 'assert';
import express from 'express';
import config from '../src/config.js';
import supabase from '../src/services/supabase.js';
import installationRoutes from '../src/routes/installation.js';
import {
  getBusinessToday,
  getBusinessTomorrow,
  createChecklist,
  updateChecklist,
} from '../src/services/installationService.js';
import {
  calculateBookingEndDate,
  checkEngineerAvailability,
  reserveEngineerAtomic,
  releaseEngineerBooking,
} from '../src/services/engineerBookingService.js';

async function runTests() {
  console.log('================================================================');
  console.log('TEST SUITE: Same-Day Installation Scheduling for Urgent Fixes');
  console.log('Business Timezone:', config.timezone);
  console.log('================================================================\n');

  const tz = config.timezone || 'Asia/Kolkata';
  const todayStr = getBusinessToday(tz);
  const tomorrowStr = getBusinessTomorrow(tz);

  const [y, m, d] = todayStr.split('-').map(Number);
  const yesterdayDate = new Date(Date.UTC(y, m - 1, d - 1));
  const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

  const dayAfterTomorrowDate = new Date(Date.UTC(y, m - 1, d + 2));
  const dayAfterTomorrowStr = dayAfterTomorrowDate.toISOString().split('T')[0];

  const nextWeekDate = new Date(Date.UTC(y, m - 1, d + 7));
  const nextWeekStr = nextWeekDate.toISOString().split('T')[0];

  console.log(`Current Business Date Reference (${tz}):`);
  console.log(`- Yesterday (Past - Must Reject):      ${yesterdayStr}`);
  console.log(`- Today (Urgent Fix - Must Allow):     ${todayStr}`);
  console.log(`- Tomorrow (Standard - Must Allow):    ${tomorrowStr}`);
  console.log(`- Day After Tomorrow (Must Allow):     ${dayAfterTomorrowStr}`);
  console.log(`- Next Week (Must Allow):              ${nextWeekStr}\n`);

  // Fetch an admin user ID for test fixtures
  const { data: adminUser } = await supabase.from('admin_users').select('id').limit(1).maybeSingle();
  const testUserId = adminUser?.id || '00000000-0000-0000-0000-000000000001';

  // Base checklist data: Use "Service" job or "2 Channel Recording" to test scheduling rules cleanly
  const baseServiceChecklist = {
    salesperson_name: 'Ranjith',
    client_name: 'Urgent Same-Day Test Client',
    client_mobile: '9876543210',
    client_location: 'Chennai Ambattur',
    device_type: '2 Channel Recording',
    number_of_devices: 1,
    number_of_vehicles: 1,
    confirmed_price: 5000,
    payment_method: 'UPI',
    installation_duration: '1 Day',
    vehicle_type: 'Truck',
    expected_arrival_time: '10:00 AM',
    installation_or_service: 'Service',
    service_engineer: 'Sakthivel',
    installation_status: 'Assigned',
  };

  const createdChecklistIds = [];

  // Setup test HTTP server for direct API testing
  const testApp = express();
  testApp.use(express.json());
  testApp.use((req, res, next) => {
    req.user = { id: testUserId, email: 'sales@example.com' };
    req.adminUser = { id: testUserId, email: 'sales@example.com', role: 'SALES' };
    req.profile = { id: testUserId, email: 'sales@example.com', role: 'SALES' };
    next();
  });
  testApp.use('/api/admin/installations', installationRoutes);

  const server = await new Promise((resolve) => {
    const s = testApp.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api/admin/installations`;
  console.log(`Direct API test server listening on ${baseUrl}\n`);

  try {
    // --------------------------------------------------------------------------
    // TEST 1: Past Dates Rejected Under Normal New-Checklist Workflow (HTTP 400)
    // --------------------------------------------------------------------------
    console.log('-> Test 1: Past Date (Yesterday) must be rejected with HTTP 400...');
    const resPast = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseServiceChecklist,
        client_name: 'Past Date Test Client',
        expected_arrival_date: yesterdayStr,
      }),
    });
    const bodyPast = await resPast.json();
    assert.strictEqual(resPast.status, 400, 'HTTP status for past date must be 400');
    assert.strictEqual(
      bodyPast.error,
      'Installation jobs cannot be scheduled in the past. Please select today or a future date.'
    );
    assert.strictEqual(bodyPast.business_today, todayStr);
    assert.strictEqual(bodyPast.provided_date, yesterdayStr);
    console.log('   ✓ Past date correctly rejected with HTTP 400 and clear error message.');

    // --------------------------------------------------------------------------
    // TEST 2: Today's Date Allowed for Urgent Same-Day Booking (HTTP 201)
    // --------------------------------------------------------------------------
    console.log('-> Test 2: Same-day booking starting today (must be accepted with HTTP 201 when engineer is available)...');
    const resToday = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseServiceChecklist,
        client_name: 'Urgent Same-Day Client 1',
        expected_arrival_date: todayStr,
        installation_duration: '1 Day',
        service_engineer: 'Sakthivel',
      }),
    });
    const bodyToday = await resToday.json();
    assert.strictEqual(resToday.status, 201, `HTTP status must be 201, got ${resToday.status}: ${JSON.stringify(bodyToday)}`);
    assert.ok(bodyToday && bodyToday.id, 'Checklist ID must be returned');
    assert.strictEqual(bodyToday.expected_arrival_date, todayStr);
    createdChecklistIds.push(bodyToday.id);
    console.log(`   ✓ Same-day booking succeeded: Checklist ${bodyToday.checklist_number} scheduled for today (${todayStr}) with Sakthivel.`);

    // --------------------------------------------------------------------------
    // TEST 3: Same-Day Booking Conflict Rejection (HTTP 409)
    // --------------------------------------------------------------------------
    console.log('-> Test 3: Same-day booking conflict rejection (attempt booking Sakthivel again today)...');
    const resConflict = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseServiceChecklist,
        client_name: 'Conflicting Same-Day Client',
        expected_arrival_date: todayStr,
        installation_duration: '1 Day',
        service_engineer: 'Sakthivel',
      }),
    });
    const bodyConflict = await resConflict.json();
    assert.strictEqual(resConflict.status, 409, `Conflicting booking must return HTTP 409, got ${resConflict.status}`);
    assert.ok(
      bodyConflict.error?.includes('Booking Conflict') || bodyConflict.error?.includes('already booked') || bodyConflict.error?.includes('unavailable'),
      `Error must describe conflict: ${bodyConflict.error}`
    );
    console.log(`   ✓ Same-day conflict correctly rejected with HTTP 409: "${bodyConflict.error}".`);

    // --------------------------------------------------------------------------
    // TEST 4: Tomorrow and Later Dates Remain Selectable (HTTP 201)
    // --------------------------------------------------------------------------
    console.log('-> Test 4a: Booking starting tomorrow remains selectable and accepted (HTTP 201)...');
    const resTomorrow = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseServiceChecklist,
        client_name: 'Tomorrow Booking Client',
        expected_arrival_date: tomorrowStr,
        service_engineer: 'Mathi',
      }),
    });
    const bodyTomorrow = await resTomorrow.json();
    assert.strictEqual(resTomorrow.status, 201, `HTTP status must be 201: ${JSON.stringify(bodyTomorrow)}`);
    createdChecklistIds.push(bodyTomorrow.id);
    console.log(`   ✓ Tomorrow booking succeeded: Checklist ${bodyTomorrow.checklist_number} scheduled for ${tomorrowStr}.`);

    console.log('-> Test 4b: Booking starting next week remains selectable and accepted (HTTP 201)...');
    const resNextWeek = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseServiceChecklist,
        client_name: 'Next Week Booking Client',
        expected_arrival_date: nextWeekStr,
        service_engineer: 'Guna',
      }),
    });
    const bodyNextWeek = await resNextWeek.json();
    assert.strictEqual(resNextWeek.status, 201, `HTTP status must be 201: ${JSON.stringify(bodyNextWeek)}`);
    createdChecklistIds.push(bodyNextWeek.id);
    console.log(`   ✓ Next week booking succeeded: Checklist ${bodyNextWeek.checklist_number} scheduled for ${nextWeekStr}.`);

    // --------------------------------------------------------------------------
    // TEST 5: Multi-Day Jobs Respect Availability Throughout Scheduled Period
    // --------------------------------------------------------------------------
    console.log('-> Test 5: Multi-day job starting today (3 Days: today -> today+2)...');
    // Kamalesh is free; schedule Kamalesh for a 3-day job
    const resMultiDay = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseServiceChecklist,
        client_name: 'Multi-Day Urgent Client',
        expected_arrival_date: todayStr,
        installation_duration: '3 Days',
        service_engineer: 'Kamalesh',
      }),
    });
    const bodyMultiDay = await resMultiDay.json();
    assert.strictEqual(resMultiDay.status, 201, `Multi-day job must succeed: ${JSON.stringify(bodyMultiDay)}`);
    createdChecklistIds.push(bodyMultiDay.id);

    const calculatedEnd = calculateBookingEndDate(todayStr, '3 Days');
    assert.strictEqual(bodyMultiDay.booking_end_date, calculatedEnd);
    console.log(`   ✓ Multi-day job scheduled: Starts ${todayStr}, Ends ${calculatedEnd} (3 full working days).`);

    // Now verify that Kamalesh is unavailable on Day 2 of this job
    const day2Date = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().split('T')[0];
    const availCheckDay2 = await checkEngineerAvailability({
      engineerIdOrName: 'Kamalesh',
      startDate: day2Date,
      duration: '1 Day',
    });
    assert.strictEqual(availCheckDay2.available, false, 'Kamalesh must be unavailable on Day 2 of 3-day job');
    console.log(`   ✓ Multi-day commitment verified: Kamalesh is unavailable on Day 2 (${day2Date}).`);

    // --------------------------------------------------------------------------
    // TEST 6: Consistency Between Frontend & Backend Timezone Rules (Asia/Kolkata)
    // --------------------------------------------------------------------------
    console.log('-> Test 6: Asia/Kolkata Timezone Boundary Verification...');
    // Test midnight roll-over in Asia/Kolkata
    // 2026-10-22 18:29:59 UTC = 2026-10-22 23:59:59 IST (Today is 2026-10-22)
    const dtBeforeMidnight = new Date('2026-10-22T18:29:59Z');
    assert.strictEqual(getBusinessToday(tz, dtBeforeMidnight), '2026-10-22');
    assert.strictEqual(getBusinessTomorrow(tz, dtBeforeMidnight), '2026-10-23');

    // 2026-10-22 18:30:00 UTC = 2026-10-23 00:00:00 IST (Today rolls over to 2026-10-23)
    const dtAtMidnight = new Date('2026-10-22T18:30:00Z');
    assert.strictEqual(getBusinessToday(tz, dtAtMidnight), '2026-10-23');
    assert.strictEqual(getBusinessTomorrow(tz, dtAtMidnight), '2026-10-24');
    console.log('   ✓ Asia/Kolkata midnight roll-over correctly determines today and tomorrow.');

    // --------------------------------------------------------------------------
    // TEST 7: Existing Checklist Schedule Updates (PUT API)
    // --------------------------------------------------------------------------
    console.log('-> Test 7: Updating existing checklist without changing date does not trigger date validation error...');
    const resUpdate = await fetch(`${baseUrl}/${bodyToday.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseServiceChecklist,
        expected_arrival_date: bodyToday.expected_arrival_date,
        remarks: 'Updated remarks for urgent fix',
      }),
    });
    assert.strictEqual(resUpdate.status, 200, 'PUT update must return HTTP 200');
    const bodyUpdate = await resUpdate.json();
    assert.strictEqual(bodyUpdate.remarks, 'Updated remarks for urgent fix');
    console.log('   ✓ Existing checklist updated successfully without conflict.');

  } finally {
    // Clean up test server
    server.close();

    // Clean up test records
    console.log('\n-> Cleaning up test records...');
    for (const id of createdChecklistIds) {
      try {
        await releaseEngineerBooking({ checklistId: id });
        await supabase.from('installation_checklists').delete().eq('id', id);
        await supabase.from('store_material_requirements').delete().eq('checklist_id', id);
        await supabase.from('engineer_bookings').delete().eq('checklist_id', id);
      } catch (err) {
        console.warn(`Error during cleanup for ${id}:`, err.message);
      }
    }
    console.log('   ✓ Cleanup completed.');
  }

  console.log('\n================================================================');
  console.log('ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
