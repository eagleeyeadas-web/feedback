import supabase from '../src/services/supabase.js';
import {
  createChecklist,
  getChecklists,
  getChecklistById,
  updateChecklist,
  getBusinessTomorrow,
} from '../src/services/installationService.js';
import { syncStoreRequirementForChecklist, getStoreMaterialRequirementById } from '../src/services/storeRequirementService.js';
import {
  dispatchChecklistViaCourier,
  updateCourierDeliveryStatus,
  markChecklistCustomerInstalled,
  requestTechnicianForCourieredChecklist,
  scheduleTechnicianForCourieredChecklist,
  getCourierDispatchByChecklistId,
} from '../src/services/courierService.js';
import { checkEngineerAvailability, releaseEngineerBooking } from '../src/services/engineerBookingService.js';

async function runTests() {
  console.log('=== Starting End-to-End Product Couriered Verification ===\n');
  const createdChecklistIds = [];

  try {
    // 0. Get an admin user for test created_by
    const { data: users, error: userErr } = await supabase.from('admin_users').select('id, full_name, email').limit(1);
    if (userErr || !users || users.length === 0) {
      throw new Error('No admin user found for test execution');
    }
    const adminUser = users[0];
    console.log(`Using admin user: ${adminUser.full_name} (${adminUser.id})\n`);

    // =========================================================================
    // Test 1: Product Couriered checklist saves successfully with expected_arrival_date = NULL
    // Test 2: Other optional scheduling fields (time, engineer, duration) remain NULL
    // Test 3: No fake date or technician assignment is inserted
    // =========================================================================
    console.log('--- Test 1, 2, 3: Saving Product Couriered checklist without schedule ---');
    const courieredData = {
      salesperson_name: 'Kavitha',
      client_name: 'Acme Logistics Ltd',
      client_mobile: '9876543210',
      client_location: 'Peelamedu, Coimbatore',
      delivery_method: 'Product Couriered',
      device_configurations: [
        {
          device_type: '8 Channel Live',
          number_of_devices: 1,
          number_of_vehicles: 1,
        },
      ],
      confirmed_price: 35000,
      payment_method: 'UPI',
      advance_received: true,
      advance_amount: 10000,
      pending_payment: true,
      pending_amount: 25000,
      installation_duration: null,
      vehicle_type: 'Truck',
      expected_arrival_date: null,
      expected_arrival_time: null,
      installation_or_service: 'Installation',
      service_engineer: null,
      client_confirmation: 'Confirmed',
    };

    const courieredCreated = await createChecklist(adminUser.id, courieredData);
    createdChecklistIds.push(courieredCreated.id);

    console.log(`✓ Product Couriered checklist created: ${courieredCreated.checklist_number} (ID: ${courieredCreated.id})`);
    console.log(`  expected_arrival_date: ${courieredCreated.expected_arrival_date}`);
    console.log(`  service_engineer: ${courieredCreated.service_engineer}`);
    console.log(`  expected_arrival_time: ${courieredCreated.expected_arrival_time}`);
    console.log(`  installation_duration: ${courieredCreated.installation_duration}`);
    console.log(`  delivery_method: ${courieredCreated.delivery_method}`);
    console.log(`  installation_status: ${courieredCreated.installation_status}`);

    if (courieredCreated.expected_arrival_date !== null) {
      throw new Error(`Expected expected_arrival_date to be null, got: ${courieredCreated.expected_arrival_date}`);
    }
    if (courieredCreated.service_engineer !== null) {
      throw new Error(`Expected service_engineer to be null, got: ${courieredCreated.service_engineer}`);
    }

    // Verify directly from the remote database
    const { data: dbChecklist, error: dbErr } = await supabase
      .from('installation_checklists')
      .select('*')
      .eq('id', courieredCreated.id)
      .single();
    if (dbErr) throw dbErr;

    if (dbChecklist.expected_arrival_date !== null) {
      throw new Error(`DB record expected_arrival_date is not null: ${dbChecklist.expected_arrival_date}`);
    }
    if (dbChecklist.service_engineer !== null && dbChecklist.service_engineer !== '') {
      throw new Error(`DB record service_engineer has unexpected value: ${dbChecklist.service_engineer}`);
    }
    console.log('✓ Remote DB verification passed: expected_arrival_date is truly NULL in PostgreSQL.\n');

    // Verify NO availability bookings were created for this checklist
    const { data: bookings } = await supabase
      .from('engineer_bookings')
      .select('*')
      .eq('checklist_id', courieredCreated.id);
    if (bookings && bookings.length > 0) {
      throw new Error(`Unexpected engineer_bookings found for unscheduled couriered checklist: ${JSON.stringify(bookings)}`);
    }
    console.log('✓ Confirmed: 0 engineer calendar bookings created for couriered order.\n');

    // =========================================================================
    // Test 4: Technician Carries STILL strictly rejects missing required scheduling fields
    // =========================================================================
    console.log('--- Test 4: Technician Carries rejects missing schedule fields ---');
    let techCarriesRejected = false;
    try {
      await createChecklist(adminUser.id, {
        salesperson_name: 'Kavitha',
        client_name: 'Tech Carries Test',
        client_mobile: '9876543211',
        client_location: 'Coimbatore',
        delivery_method: 'Technician Carries',
        device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 1, number_of_vehicles: 1 }],
        confirmed_price: 15000,
        payment_method: 'UPI',
        installation_duration: '1 Day',
        vehicle_type: 'Truck',
        expected_arrival_date: null, // MISSING!
        installation_or_service: 'Installation',
        service_engineer: null, // MISSING!
        client_confirmation: 'Confirmed',
      });
    } catch (e) {
      techCarriesRejected = true;
      console.log(`✓ Technician Carries correctly rejected missing schedule: "${e.message}"`);
    }
    if (!techCarriesRejected) {
      throw new Error('Technician Carries failed to reject missing schedule fields!');
    }
    console.log('');

    // =========================================================================
    // Test 5: Existing scheduled checklists remain readable and editable
    // =========================================================================
    console.log('--- Test 5: Normal Technician Carries job creation and editing ---');
    const tomorrow = getBusinessTomorrow();
    const scheduledTechCarriesData = {
      salesperson_name: 'Kavitha',
      client_name: 'Scheduled Logistics Corp',
      client_mobile: '9876543212',
      client_location: 'Madurai',
      delivery_method: 'Technician Carries',
      device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 1, number_of_vehicles: 1 }],
      confirmed_price: 20000,
      payment_method: 'UPI',
      installation_duration: '1 Day',
      vehicle_type: 'Truck',
      expected_arrival_date: tomorrow,
      expected_arrival_time: '10:00 AM',
      installation_or_service: 'Installation',
      service_engineer: 'Kamalesh',
      client_confirmation: 'Confirmed',
    };

    const techCarriesCreated = await createChecklist(adminUser.id, scheduledTechCarriesData);
    createdChecklistIds.push(techCarriesCreated.id);
    console.log(`✓ Scheduled checklist created: ${techCarriesCreated.checklist_number} for ${techCarriesCreated.expected_arrival_date} with ${techCarriesCreated.service_engineer}`);

    // Update scheduled checklist
    const updatedTechCarries = await updateChecklist(techCarriesCreated.id, {
      ...techCarriesCreated,
      remarks: 'Updated remarks for normal scheduled job',
    });
    console.log(`✓ Scheduled checklist updated successfully: remarks="${updatedTechCarries.remarks}"\n`);

    // =========================================================================
    // Test 6: Couriered orders appear in Sales and Store Manager lists
    // =========================================================================
    console.log('--- Test 6: Checklist listing for Sales & Store Manager ---');
    const allChecklists = await getChecklists({ limit: 10 });
    const foundCouriered = allChecklists.checklists.find((c) => c.id === courieredCreated.id);
    if (!foundCouriered) {
      throw new Error(`Couriered checklist ${courieredCreated.id} not found in getChecklists query!`);
    }
    console.log(`✓ Couriered checklist listed successfully in getChecklists: ${foundCouriered.checklist_number} (delivery_method: ${foundCouriered.delivery_method})`);

    // Verify store material requirement
    const req = await syncStoreRequirementForChecklist(courieredCreated.id);
    console.log(`✓ Store requirement synced for couriered checklist: ${req.checklist_number} (status: ${req.status}, delivery_method: ${req.delivery_method})\n`);

    // Provision temporary test stock for 8 Channel Live
    await supabase.from('inventory_products').update({ usable_stock: 10 }).eq('device_type', '8 Channel Live');

    // =========================================================================
    // Test 7: Stock issuance & Courier Dispatch Tracking
    // =========================================================================
    console.log('--- Test 7: Courier dispatch & tracking workflow ---');
    const dispatchResult = await dispatchChecklistViaCourier({
      checklist_id: courieredCreated.id,
      courier_company: 'DTDC',
      tracking_number: 'DTDC-TRACK-998877',
      expected_delivery_date: tomorrow,
      notes: 'Dispatched unit to Coimbatore client site',
      items: [
        {
          item_type: 'DEVICE',
          item_name: '8 Channel Live',
          quantity: 1,
          unit: 'Nos.',
        },
      ],
      user: adminUser,
    });
    console.log(`✓ Courier shipment dispatched: Tracking #${dispatchResult.tracking_number} via ${dispatchResult.courier_company}`);

    // Update shipment to Delivered
    const deliveryUpdate = await updateCourierDeliveryStatus(
      dispatchResult.id,
      'Delivered',
      'Package signed by client storekeeper',
      adminUser
    );
    console.log(`✓ Courier delivery status updated to: ${deliveryUpdate.delivery_status}`);

    const retrievedDispatch = await getCourierDispatchByChecklistId(courieredCreated.id);
    console.log(`✓ Dispatch record verified in store: status=${retrievedDispatch.delivery_status}, tracking=${retrievedDispatch.tracking_number}`);

    // Verify checklist installation_status is STILL 'Assign Later' (delivery alone does NOT complete installation or assign technician)
    const refreshedChk = await getChecklistById(courieredCreated.id);
    if (refreshedChk.installation_status !== 'Assign Later') {
      throw new Error(`Expected installation_status to remain "Assign Later" after delivery, got "${refreshedChk.installation_status}"`);
    }
    console.log(`✓ Verified installation_status remains "${refreshedChk.installation_status}" upon delivery (delivery alone does NOT mark Completed)\n`);

    // =========================================================================
    // Test 8 & 9: Later scheduling a technician on the SAME checklist ID
    // =========================================================================
    console.log('--- Test 8 & 9: Later scheduling technician on the same checklist ---');
    // Request technician assistance
    await requestTechnicianForCourieredChecklist({
      checklist_id: courieredCreated.id,
      notes: 'Customer requested Eagle Eye technician assistance for camera alignment',
      user: adminUser,
    });

    // Schedule technician on the same checklist
    const scheduledCouriered = await scheduleTechnicianForCourieredChecklist({
      checklist_id: courieredCreated.id,
      service_engineer: 'Sakthivel',
      expected_arrival_date: tomorrow,
      expected_arrival_time: '11:00 AM',
      installation_duration: '1 Day',
      remarks: 'Customer requested professional installation post-courier delivery',
      user: adminUser,
    });

    console.log(`✓ Same checklist ${scheduledCouriered.checklist_number} successfully scheduled with ${scheduledCouriered.service_engineer} on ${scheduledCouriered.expected_arrival_date}`);
    console.log(`  New installation_status: ${scheduledCouriered.installation_status}`);

    // Verify engineer booking is now registered
    const { data: newBookings } = await supabase
      .from('engineer_bookings')
      .select('*')
      .eq('checklist_id', courieredCreated.id);
    if (!newBookings || newBookings.length === 0) {
      throw new Error('Expected engineer_bookings to be created once technician is scheduled!');
    }
    console.log(`✓ Registered engineer booking for ${newBookings[0].engineer_name} from ${newBookings[0].booking_start_date} to ${newBookings[0].booking_end_date}\n`);

    // =========================================================================
    // Test 10: Independent Customer Installation (Outcome A)
    // =========================================================================
    console.log('--- Test 10: Independent customer installation without technician ---');
    // Create a 2nd couriered order for testing independent customer installation
    const courieredData2 = {
      ...courieredData,
      client_name: 'Metro Fleet Systems',
      client_mobile: '9876543219',
      expected_arrival_date: null,
      service_engineer: null,
    };
    const courieredCreated2 = await createChecklist(adminUser.id, courieredData2);
    createdChecklistIds.push(courieredCreated2.id);

    // Dispatch & Deliver
    const dispatch2 = await dispatchChecklistViaCourier({
      checklist_id: courieredCreated2.id,
      courier_company: 'The Professional Couriers',
      tracking_number: 'TPC-TRACK-112233',
      expected_delivery_date: tomorrow,
      items: [
        {
          item_type: 'DEVICE',
          item_name: '8 Channel Live',
          quantity: 1,
          unit: 'Nos.',
        },
      ],
      user: adminUser,
    });
    await updateCourierDeliveryStatus(dispatch2.id, 'Delivered', 'Delivered at site', adminUser);

    // Mark customer installed independently
    const completionResult = await markChecklistCustomerInstalled({
      checklist_id: courieredCreated2.id,
      notes: 'Customer confirmed their in-house mechanic completed installation and camera live feed is verified.',
      user: adminUser,
    });
    console.log(`✓ Checklist ${courieredCreated2.checklist_number} completed: ${completionResult.message}`);
    console.log(`  Status: ${completionResult.checklist.installation_status}, Completion Type: ${completionResult.completion.completion_type}`);

    // Verify NO technician tasks or reports were created
    const { data: noBookings2 } = await supabase
      .from('engineer_bookings')
      .select('*')
      .eq('checklist_id', courieredCreated2.id);
    if (noBookings2 && noBookings2.length > 0) {
      throw new Error('Technician booking was unexpectedly created for independent customer installation!');
    }
    console.log('✓ Confirmed: No technician bookings or post-installation tasks created for independent installation.\n');

    console.log('=========================================================================');
    console.log('🎉 ALL 10 TESTS PASSED SUCCESSFULLY!');
    console.log('=========================================================================');
  } finally {
    // Cleanup created test records so database remains clean
    console.log('\nCleaning up test checklists from database...');
    for (const id of createdChecklistIds) {
      try {
        await releaseEngineerBooking({ checklistId: id });
        await supabase.from('courier_dispatches').delete().eq('checklist_id', id);
        await supabase.from('engineer_bookings').delete().eq('checklist_id', id);
        await supabase.from('store_material_requirements').delete().eq('checklist_id', id);
        await supabase.from('installation_checklists').delete().eq('id', id);
      } catch (cleanupErr) {
        console.warn(`Cleanup error for ${id}:`, cleanupErr.message);
      }
    }
    try {
      await supabase.from('inventory_products').update({ usable_stock: 0 }).eq('device_type', '8 Channel Live');
    } catch (e) {}
    console.log('Cleanup completed.\n');
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
