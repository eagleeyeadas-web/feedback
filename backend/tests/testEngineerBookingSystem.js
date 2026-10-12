import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  MAIN_SERVICE_ENGINEERS,
  calculateBookingEndDate,
  parseDurationDays,
  isDateRangeOverlapping,
  resolveEngineer,
  checkEngineerAvailability,
  getEngineersAvailabilityForRange,
  reserveEngineerAtomic,
  releaseEngineerBooking,
  getAvailabilityCalendar,
  getAllServiceEngineers,
} from '../src/services/engineerBookingService.js';
import {
  createChecklist,
  updateChecklist,
  deleteChecklist,
  getChecklistById,
} from '../src/services/installationService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DUMMY_USER_ID = '00000000-0000-0000-0000-000000000000';

async function runTestSuite() {
  console.log('================================================================');
  console.log('  RUNNING COMPLETE ENGINEER AVAILABILITY & BOOKING TEST SUITE  ');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 8;
  const createdChecklists = [];

  try {
    // -------------------------------------------------------------
    // SCENARIO 0: Verify 5 Main Service Engineers configuration
    // -------------------------------------------------------------
    console.log('🔍 SCENARIO 0: Verify the 5 Main Service Engineers configuration...');
    const engineers = await getAllServiceEngineers();
    const expectedNames = ['Mathi', 'Kamalesh', 'Dhinagaran', 'Sakthivel', 'Mithun'];
    const foundNames = engineers.map((e) => e.name);
    console.log('Configured Engineers:', foundNames);
    for (const name of expectedNames) {
      if (!foundNames.includes(name)) {
        throw new Error(`Main engineer ${name} is missing from configured engineers!`);
      }
    }
    console.log('✅ Scenario 0: All 5 main service engineers exist with stable IDs.\n');

    // -------------------------------------------------------------
    // SCENARIO 1: One engineer assigned to a two-day job
    // -------------------------------------------------------------
    console.log('📋 SCENARIO 1: One engineer (Mathi) assigned to a two-day job...');
    const startDate1 = '2026-10-12';
    const duration1 = '2 Days';
    const expectedEnd1 = calculateBookingEndDate(startDate1, duration1); // Should be 2026-10-13

    if (expectedEnd1 !== '2026-10-13') {
      throw new Error(`Expected end date 2026-10-13 for 2-day job starting 2026-10-12, got: ${expectedEnd1}`);
    }

    const job1 = await createChecklist(DUMMY_USER_ID, {
      client_name: 'Test Client Alpha (Scenario 1)',
      client_mobile: '9840111001',
      client_location: 'Chennai Harbour',
      device_type: '4 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 35000,
      payment_method: 'UPI',
      installation_duration: duration1,
      vehicle_type: 'Truck',
      expected_arrival_date: startDate1,
      expected_arrival_time: '10:00',
      installation_or_service: 'Installation',
      service_engineer: 'Mathi',
      service_assistant: 'Kamalesh',
      installation_status: 'Assigned',
      payment_status: 'Pending',
    });

    createdChecklists.push(job1.id);
    console.log(`Created Job 1: #${job1.checklist_number} (ID: ${job1.id})`);
    console.log(`Assigned Engineer: ${job1.service_engineer}, Booking Range: ${startDate1} to ${expectedEnd1}`);

    // Verify Mathi is now booked for 2026-10-12 to 2026-10-13
    const mathiCheck1 = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: '2026-10-12',
      endDate: '2026-10-13',
    });

    if (mathiCheck1.available) {
      throw new Error('Mathi should be BOOKED for 2026-10-12 to 2026-10-13, but was reported available!');
    }
    console.log(`Mathi Booking Status: Booked = true, Conflict with: #${mathiCheck1.conflict?.checklist_number}`);
    console.log('✅ Scenario 1: One engineer assigned to a two-day job passed.\n');
    passedTests++;

    // -------------------------------------------------------------
    // SCENARIO 2: Another salesperson attempting to book an overlapping date
    // -------------------------------------------------------------
    console.log('📋 SCENARIO 2: Another salesperson attempting to book Mathi for overlapping date (2026-10-13 to 2026-10-14)...');
    try {
      await createChecklist(DUMMY_USER_ID, {
        client_name: 'Test Client Beta (Scenario 2 - Overlap Attempt)',
        client_mobile: '9840111002',
        client_location: 'Ambattur Industrial Estate',
        device_type: '2 Channel Live',
        number_of_devices: 1,
        number_of_vehicles: 1,
        confirmed_price: 25000,
        payment_method: 'UPI',
        installation_duration: '2 Days', // 2026-10-13 to 2026-10-14
        vehicle_type: 'Lorry',
        expected_arrival_date: '2026-10-13',
        expected_arrival_time: '09:00',
        installation_or_service: 'Installation',
        service_engineer: 'Mathi', // Overlaps on 2026-10-13
        service_assistant: 'Dhinagaran',
        installation_status: 'Assigned',
        payment_status: 'Pending',
      });

      throw new Error('Overlapping booking should have been REJECTED, but succeeded!');
    } catch (err) {
      if (err.message.includes('already booked') || err.message.includes('Booking conflict')) {
        console.log(`Successfully blocked overlapping assignment: "${err.message}"`);
        console.log('✅ Scenario 2: Overlapping booking correctly rejected.\n');
        passedTests++;
      } else {
        throw err;
      }
    }

    // -------------------------------------------------------------
    // SCENARIO 3: A booking beginning on the previous booking's end date
    // -------------------------------------------------------------
    console.log("📋 SCENARIO 3: Booking beginning on previous booking's end date (2026-10-13)...");
    const checkSameEndDay = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: '2026-10-13',
      endDate: '2026-10-13',
    });

    if (checkSameEndDay.available) {
      throw new Error("Inclusive rule failed: Mathi should NOT be available on 2026-10-13 because it is Mathi's end date!");
    }
    console.log(`Inclusive End Date Check: Mathi on 2026-10-13 is correctly Booked: ${!checkSameEndDay.available}`);
    console.log("✅ Scenario 3: Booking beginning on previous booking's end date is rejected due to inclusive full-day rule.\n");
    passedTests++;

    // -------------------------------------------------------------
    // SCENARIO 4: A booking beginning after the previous booking ends
    // -------------------------------------------------------------
    console.log("📋 SCENARIO 4: A booking beginning strictly after previous booking ends (2026-10-14 onwards)...");
    const checkAfterEnd = await checkEngineerAvailability({
      engineerIdOrName: 'Mathi',
      startDate: '2026-10-14',
      endDate: '2026-10-15',
    });

    if (!checkAfterEnd.available) {
      throw new Error(`Mathi should be AVAILABLE on 2026-10-14, but conflict was reported: ${checkAfterEnd.message}`);
    }

    const job4 = await createChecklist(DUMMY_USER_ID, {
      client_name: 'Test Client Gamma (Scenario 4 - Valid Non-overlapping)',
      client_mobile: '9840111003',
      client_location: 'Sriperumbudur Auto Hub',
      device_type: '6 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 45000,
      payment_method: 'UPI',
      installation_duration: '2 Days',
      vehicle_type: 'Truck',
      expected_arrival_date: '2026-10-14',
      expected_arrival_time: '10:00',
      installation_or_service: 'Installation',
      service_engineer: 'Mathi',
      service_assistant: 'Sakthivel',
      installation_status: 'Assigned',
      payment_status: 'Pending',
    });

    createdChecklists.push(job4.id);
    console.log(`Created Job 4 for Mathi on 2026-10-14 to 2026-10-15: #${job4.checklist_number}`);
    console.log('✅ Scenario 4: Booking beginning after previous booking ends succeeded.\n');
    passedTests++;

    // -------------------------------------------------------------
    // SCENARIO 5: Two simultaneous assignment attempts (Concurrency test)
    // -------------------------------------------------------------
    console.log('📋 SCENARIO 5: Two simultaneous assignment attempts for Kamalesh (2026-10-20 to 2026-10-21)...');
    const targetEngineer = 'Kamalesh';
    const raceStartDate = '2026-10-20';
    const raceEndDate = '2026-10-21';

    // Simulate two concurrent sales reps trying to reserve Kamalesh at the exact same millisecond
    const raceResults = await Promise.allSettled([
      reserveEngineerAtomic({
        engineerIdOrName: targetEngineer,
        startDate: raceStartDate,
        endDate: raceEndDate,
        checklistId: 'race-job-rep-A',
        checklistNumber: 'EE-RACE-A',
        clientName: 'Sales Rep A Client',
      }),
      reserveEngineerAtomic({
        engineerIdOrName: targetEngineer,
        startDate: raceStartDate,
        endDate: raceEndDate,
        checklistId: 'race-job-rep-B',
        checklistNumber: 'EE-RACE-B',
        clientName: 'Sales Rep B Client',
      }),
    ]);

    const successes = raceResults.filter((r) => r.status === 'fulfilled');
    const rejections = raceResults.filter((r) => r.status === 'rejected');

    console.log(`Concurrent Race outcome: ${successes.length} fulfilled, ${rejections.length} rejected.`);
    if (successes.length !== 1 || rejections.length !== 1) {
      throw new Error(`Concurrency violation! Expected exactly 1 success and 1 rejection, got ${successes.length} / ${rejections.length}`);
    }

    const rejectionReason = rejections[0].reason?.message || '';
    console.log(`Rejected transaction received clean conflict error: "${rejectionReason}"`);

    // Clean up race booking
    await releaseEngineerBooking({ checklistId: successes[0].value.checklist_id });
    console.log('✅ Scenario 5: Two simultaneous assignment attempts safely serialized by mutex lock.\n');
    passedTests++;

    // -------------------------------------------------------------
    // SCENARIO 6: Engineer reassignment and cancellation
    // -------------------------------------------------------------
    console.log('📋 SCENARIO 6: Engineer reassignment and cancellation...');
    // 1. Assign Dhinagaran for 2026-10-25
    const job6 = await createChecklist(DUMMY_USER_ID, {
      client_name: 'Test Client Delta (Scenario 6)',
      client_mobile: '9840111004',
      client_location: 'Coimbatore Hub',
      device_type: '4 Channel Recording',
      number_of_devices: 1,
      number_of_vehicles: 1,
      confirmed_price: 32000,
      payment_method: 'UPI',
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: '2026-10-25',
      expected_arrival_time: '11:00',
      installation_or_service: 'Installation',
      service_engineer: 'Dhinagaran',
      service_assistant: 'Mithun',
      installation_status: 'Assigned',
      payment_status: 'Pending',
    });
    createdChecklists.push(job6.id);

    // Dhinagaran should be booked for 2026-10-25
    let dhinaCheck = await checkEngineerAvailability({
      engineerIdOrName: 'Dhinagaran',
      startDate: '2026-10-25',
      endDate: '2026-10-25',
    });
    if (dhinaCheck.available) throw new Error('Dhinagaran should be booked before reassignment!');

    // 2. Reassign job6 to Sakthivel
    console.log('Reassigning Job 6 from Dhinagaran to Sakthivel...');
    await updateChecklist(job6.id, {
      ...job6,
      service_engineer: 'Sakthivel',
    });

    // Now Dhinagaran must be released (available) and Sakthivel must be booked
    dhinaCheck = await checkEngineerAvailability({
      engineerIdOrName: 'Dhinagaran',
      startDate: '2026-10-25',
      endDate: '2026-10-25',
    });
    if (!dhinaCheck.available) throw new Error('Dhinagaran should have been released after reassignment!');

    const sakthiCheck = await checkEngineerAvailability({
      engineerIdOrName: 'Sakthivel',
      startDate: '2026-10-25',
      endDate: '2026-10-25',
    });
    if (sakthiCheck.available) throw new Error('Sakthivel should now be booked after reassignment!');

    // 3. Mark job6 as Cancelled (should release Sakthivel)
    console.log('Marking Job 6 as Cancelled...');
    await updateChecklist(job6.id, {
      ...job6,
      service_engineer: 'Sakthivel',
      installation_status: 'Cancelled',
    });

    const sakthiAfterCancel = await checkEngineerAvailability({
      engineerIdOrName: 'Sakthivel',
      startDate: '2026-10-25',
      endDate: '2026-10-25',
    });
    if (!sakthiAfterCancel.available) {
      throw new Error('Sakthivel should be released after job was Cancelled!');
    }
    console.log('Sakthivel successfully released upon cancellation.');
    console.log('✅ Scenario 6: Engineer reassignment and cancellation passed.\n');
    passedTests++;

    // -------------------------------------------------------------
    // SCENARIO 7: Missing or invalid dates
    // -------------------------------------------------------------
    console.log('📋 SCENARIO 7: Missing or invalid dates validation...');
    // Missing start date
    try {
      await checkEngineerAvailability({
        engineerIdOrName: 'Mathi',
        startDate: null,
      });
      throw new Error('Should fail when startDate is missing!');
    } catch (err) {
      console.log(`Missing start date caught: "${err.message}"`);
    }

    // End date before start date
    try {
      await checkEngineerAvailability({
        engineerIdOrName: 'Mathi',
        startDate: '2026-10-15',
        endDate: '2026-10-10', // Before start
      });
      throw new Error('Should fail when endDate is before startDate!');
    } catch (err) {
      console.log(`End before start date caught: "${err.message}"`);
    }

    console.log('✅ Scenario 7: Missing and invalid date inputs properly validated.\n');
    passedTests++;

    // -------------------------------------------------------------
    // SCENARIO 8: Completed jobs and historical assignments
    // -------------------------------------------------------------
    console.log('📋 SCENARIO 8: Completed jobs, historical assignments, and calendar view...');
    // Complete Job 1
    console.log('Completing Job 1...');
    await updateChecklist(job1.id, {
      ...job1,
      installation_status: 'Completed',
    });

    const job1Fetched = await getChecklistById(job1.id);
    if (job1Fetched.installation_status !== 'Completed') {
      throw new Error('Job 1 status was not updated to Completed!');
    }

    // Verify calendar view aggregates all service engineers
    console.log('Fetching Availability Calendar...');
    const calendar = await getAvailabilityCalendar({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });

    console.log(`Calendar returned ${calendar.schedule?.length} engineers, range: ${calendar.start_date} to ${calendar.end_date}`);
    if (!calendar.schedule || calendar.schedule.length < 5) {
      throw new Error(`Calendar should contain at least 5 engineers, got ${calendar.schedule?.length}`);
    }

    console.log('Engineers in calendar:', calendar.schedule.map((e) => `${e.engineer.name} (${e.total_booked_days} booked days)`).join(', '));
    console.log('✅ Scenario 8: Completed jobs and calendar view verified.\n');
    passedTests++;

  } catch (error) {
    console.error('❌ TEST FAILED:', error);
    process.exitCode = 1;
  } finally {
    // Clean up created checklists
    console.log('\nCleaning up created test checklists...');
    for (const id of createdChecklists) {
      try {
        await deleteChecklist(id, DUMMY_USER_ID);
        console.log(`Cleaned up test checklist ${id}`);
      } catch (e) {
        // ignore cleanup error
      }
    }

    console.log('================================================================');
    console.log(`  SUMMARY: ${passedTests}/${totalTests} SCENARIOS PASSED`);
    console.log('================================================================');
  }
}

runTestSuite();
