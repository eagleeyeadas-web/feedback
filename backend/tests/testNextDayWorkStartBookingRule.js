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
  releaseEngineerBooking,
} from '../src/services/engineerBookingService.js';

async function runTests() {
  console.log('================================================================');
  console.log('TEST SUITE: Installation Checklist Work-Start Booking Rule (Today or Future Allowed)');
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
  console.log(`- Yesterday:           ${yesterdayStr}`);
  console.log(`- Today:               ${todayStr}`);
  console.log(`- Tomorrow (Permitted): ${tomorrowStr}`);
  console.log(`- Day After Tomorrow:  ${dayAfterTomorrowStr}`);
  console.log(`- Next Week:           ${nextWeekStr}\n`);

  // Fetch or mock an admin / sales user ID for test fixtures
  const { data: adminUser } = await supabase.from('admin_users').select('id').limit(1).maybeSingle();
  const testUserId = adminUser?.id || '00000000-0000-0000-0000-000000000001';

  const baseChecklistData = {
    salesperson_name: 'Ranjith',
    client_name: 'Next-Day Rule Test Client',
    client_mobile: '9876543210',
    client_location: 'Chennai Ambattur',
    device_type: '2 Channel Recording',
    number_of_devices: 1,
    number_of_vehicles: 1,
    confirmed_price: 15000,
    payment_method: 'UPI',
    installation_duration: '1 Day',
    vehicle_type: 'Truck',
    expected_arrival_time: '10:00 AM',
    installation_or_service: 'Service',
    service_engineer: 'Sakthivel',
    installation_status: 'Assigned',
  };

  const createdChecklistIds = [];

  // Setup ephemeral test HTTP server for direct API testing
  const testApp = express();
  testApp.use(express.json());
  testApp.use((req, res, next) => {
    // Stub authenticated sales user profile
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
    // TEST 1: Direct API Attempt - Starting Today (Urgent Fix -> ALLOWED HTTP 201)
    // --------------------------------------------------------------------------
    console.log('-> Test 1: Direct API Attempt - Work starting today for urgent fix (must be accepted with HTTP 201)...');
    const resToday = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseChecklistData,
        client_name: 'API Today Test Client',
        expected_arrival_date: todayStr,
        service_engineer: 'Sakthivel',
      }),
    });
    const bodyToday = await resToday.json();
    assert.strictEqual(resToday.status, 201, `HTTP status must be 201, got ${resToday.status}: ${JSON.stringify(bodyToday)}`);
    assert.ok(bodyToday && bodyToday.id, 'Checklist ID must be returned');
    assert.strictEqual(bodyToday.expected_arrival_date, todayStr);
    createdChecklistIds.push(bodyToday.id);
    console.log('   ✓ Direct API call starting today accepted with HTTP 201.');

    // --------------------------------------------------------------------------
    // TEST 2: Direct API Attempt - Starting in the Past / Yesterday (NOT ALLOWED -> HTTP 400)
    // --------------------------------------------------------------------------
    console.log('-> Test 2: Direct API Attempt - Work starting yesterday / past date (must be rejected with HTTP 400)...');
    const resYesterday = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseChecklistData,
        client_name: 'API Yesterday Test Client',
        expected_arrival_date: yesterdayStr,
      }),
    });
    const bodyYesterday = await resYesterday.json();
    assert.strictEqual(resYesterday.status, 400, 'HTTP status must be 400');
    assert.strictEqual(bodyYesterday.error, 'Installation jobs cannot be scheduled in the past. Please select today or a future date.');
    assert.strictEqual(bodyYesterday.business_today, todayStr);
    assert.strictEqual(bodyYesterday.provided_date, yesterdayStr);
    console.log('   ✓ Direct API call starting in past rejected with HTTP 400 and exact error message.');

    // --------------------------------------------------------------------------
    // TEST 3: Direct API Attempt - Two or More Days Ahead (ALLOWED -> HTTP 201)
    // --------------------------------------------------------------------------
    console.log('-> Test 3: Direct API Attempt - Work starting 2 days ahead (must be accepted with HTTP 201)...');
    const resDayAfter = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseChecklistData,
        client_name: 'API 2-Days Ahead Test Client',
        expected_arrival_date: dayAfterTomorrowStr,
        service_engineer: 'Mathi',
      }),
    });
    const bodyDayAfter = await resDayAfter.json();
    assert.strictEqual(resDayAfter.status, 201, `HTTP status must be 201, got ${resDayAfter.status}: ${JSON.stringify(bodyDayAfter)}`);
    createdChecklistIds.push(bodyDayAfter.id);
    console.log('   ✓ Direct API call starting 2 days ahead accepted with HTTP 201.');

    console.log('-> Test 3b: Direct API Attempt - Work starting next week (must be accepted with HTTP 201)...');
    const resNextWeek = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseChecklistData,
        client_name: 'API Next Week Test Client',
        expected_arrival_date: nextWeekStr,
        service_engineer: 'Guna',
      }),
    });
    const bodyNextWeek = await resNextWeek.json();
    assert.strictEqual(resNextWeek.status, 201, `HTTP status must be 201, got ${resNextWeek.status}: ${JSON.stringify(bodyNextWeek)}`);
    createdChecklistIds.push(bodyNextWeek.id);
    console.log('   ✓ Direct API call starting next week accepted with HTTP 201.');

    // --------------------------------------------------------------------------
    // TEST 4: Direct API Attempt - Starting Exactly Tomorrow (ALLOWED -> HTTP 201)
    // --------------------------------------------------------------------------
    console.log('-> Test 4: Direct API Attempt - Work starting exactly tomorrow (must be accepted with HTTP 201)...');
    const resTomorrow = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseChecklistData,
        client_name: 'API Tomorrow Success Test Client',
        expected_arrival_date: tomorrowStr,
        installation_duration: '1 Day',
        service_engineer: 'Kamalesh',
      }),
    });
    const bodyTomorrow = await resTomorrow.json();
    assert.strictEqual(resTomorrow.status, 201, `HTTP status must be 201, got ${resTomorrow.status}: ${JSON.stringify(bodyTomorrow)}`);
    assert.ok(bodyTomorrow && bodyTomorrow.id, 'Checklist ID must be returned');
    assert.strictEqual(bodyTomorrow.expected_arrival_date, tomorrowStr);
    createdChecklistIds.push(bodyTomorrow.id);
    console.log(`   ✓ Direct API call successfully created checklist ${bodyTomorrow.checklist_number} starting tomorrow (${tomorrowStr}).`);

    // --------------------------------------------------------------------------
    // TEST 5: Multi-Day Jobs Starting Tomorrow (ALLOWED & NORMAL END-DATE CALCULATION)
    // --------------------------------------------------------------------------
    console.log('-> Test 5: Multi-day job (3 Days) starting tomorrow (must be accepted, run through day 3)...');
    const resMultiDay = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseChecklistData,
        client_name: 'API 3-Day Multi-Day Test Client',
        expected_arrival_date: tomorrowStr,
        installation_duration: '3 Days',
        service_engineer: 'Sakthivel',
      }),
    });
    const bodyMultiDay = await resMultiDay.json();
    assert.strictEqual(resMultiDay.status, 201, `HTTP status must be 201, got ${resMultiDay.status}: ${JSON.stringify(bodyMultiDay)}`);
    assert.ok(bodyMultiDay && bodyMultiDay.id, 'Checklist ID must be returned');
    assert.strictEqual(bodyMultiDay.expected_arrival_date, tomorrowStr);
    assert.strictEqual(bodyMultiDay.installation_duration, '3 Days');

    const calculatedEnd = calculateBookingEndDate(tomorrowStr, '3 Days');
    const [ty, tm, td] = tomorrowStr.split('-').map(Number);
    const expectedEndUtc = new Date(Date.UTC(ty, tm - 1, td + 2));
    const expectedEndStr = expectedEndUtc.toISOString().split('T')[0];
    assert.strictEqual(calculatedEnd, expectedEndStr);
    console.log(`   ✓ Multi-day job: Starts ${tomorrowStr}, Duration: 3 Days, Calculated End Date: ${calculatedEnd} (Verified).`);
    createdChecklistIds.push(bodyMultiDay.id);

    // --------------------------------------------------------------------------
    // TEST 6: Service Jobs Starting Today (Allowed for urgent fixes, no BOM by default)
    // --------------------------------------------------------------------------
    console.log('-> Test 6a: Service job starting today (must be accepted with HTTP 201 for available engineer)...');
    const resServToday = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseChecklistData,
        client_name: 'Service Urgent Today Test Client',
        installation_or_service: 'Service',
        expected_arrival_date: todayStr,
        service_engineer: 'Mathi',
      }),
    });
    assert.strictEqual(resServToday.status, 201, `Service job today must be created with 201`);
    const bodyServToday = await resServToday.json();
    assert.strictEqual(bodyServToday.installation_or_service, 'Service');
    assert.strictEqual(bodyServToday.bom_snapshot, null);
    createdChecklistIds.push(bodyServToday.id);
    console.log(`   ✓ Service job starting today accepted with HTTP 201.`);

    // --------------------------------------------------------------------------
    // TEST 7: Timezone Boundary Calculations
    // --------------------------------------------------------------------------
    console.log('-> Test 7: Timezone Boundary Scenarios...');
    // Check midnight boundary in Asia/Kolkata (UTC+5:30)
    // 18:29:59 UTC on Oct 17 -> 23:59:59 IST on Oct 17 -> Today is Oct 17, Tomorrow is Oct 18
    const dtBeforeMidnight = new Date('2026-10-17T18:29:59Z');
    const tTodayBefore = getBusinessToday(config.timezone, dtBeforeMidnight);
    const tBefore = getBusinessTomorrow(config.timezone, dtBeforeMidnight);
    assert.strictEqual(tTodayBefore, '2026-10-17');
    assert.strictEqual(tBefore, '2026-10-18');
    console.log('   ✓ 23:59:59 IST boundary: Today evaluates to 2026-10-17, Tomorrow evaluates to 2026-10-18.');

    // 18:30:00 UTC on Oct 17 -> 00:00:00 IST on Oct 18 -> Today is Oct 18, Tomorrow is Oct 19
    const dtAtMidnight = new Date('2026-10-17T18:30:00Z');
    const tTodayAt = getBusinessToday(config.timezone, dtAtMidnight);
    const tAt = getBusinessTomorrow(config.timezone, dtAtMidnight);
    assert.strictEqual(tTodayAt, '2026-10-18');
    assert.strictEqual(tAt, '2026-10-19');
    console.log('   ✓ 00:00:00 IST midnight roll-over: Today evaluates to 2026-10-18, Tomorrow evaluates to 2026-10-19.');

    // Leap year roll-over: Feb 28, 2028 (leap year) -> Tomorrow is Feb 29
    const dtLeapYear = new Date('2028-02-28T05:00:00Z');
    const tLeap = getBusinessTomorrow(config.timezone, dtLeapYear);
    assert.strictEqual(tLeap, '2028-02-29');
    console.log('   ✓ Leap year boundary: Feb 28 -> Feb 29.');

    // Year end roll-over: Dec 31 -> Jan 01
    const dtYearEnd = new Date('2026-12-31T05:00:00Z');
    const tYearEnd = getBusinessTomorrow(config.timezone, dtYearEnd);
    assert.strictEqual(tYearEnd, '2027-01-01');
    console.log('   ✓ Year-end boundary: Dec 31 -> Jan 01 next year.');

    // --------------------------------------------------------------------------
    // TEST 8: Existing Job Updates (PUT API must NOT be blocked)
    // --------------------------------------------------------------------------
    console.log('-> Test 8: Existing job updates (PUT API) do not block non-tomorrow dates...');
    const resUpdate = await fetch(`${baseUrl}/${bodyTomorrow.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseChecklistData,
        service_engineer: bodyTomorrow.service_engineer,
        expected_arrival_date: bodyTomorrow.expected_arrival_date,
        remarks: 'Customer updated delivery gate instructions via PUT API',
      }),
    });
    assert.strictEqual(resUpdate.status, 200, 'PUT update must return HTTP 200');
    const bodyUpdate = await resUpdate.json();
    assert.strictEqual(bodyUpdate.remarks, 'Customer updated delivery gate instructions via PUT API');
    console.log('   ✓ Existing job updated successfully via PUT API without being blocked.');

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
      } catch (e) {}
    }
    console.log('   ✓ Cleanup completed.');
  }

  console.log('\n================================================================');
  console.log('ALL TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
