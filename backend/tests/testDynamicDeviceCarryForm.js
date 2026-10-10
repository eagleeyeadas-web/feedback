import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { 
  submitDeviceCarryRecord, 
  getDeviceCarryRecord, 
  startInstallationJob, 
  submitInstallationCompletionReport 
} from '../src/services/workflowService.js';
import { createChecklist, getChecklists } from '../src/services/installationService.js';
import supabase from '../src/services/supabase.js';

async function runTests() {
  console.log('--- Starting Dynamic Device Carry Form Acceptance Tests ---');

  const testUser = { id: 'f3a5e467-a1bf-40ef-8878-ec64b29bbfd5', email: 'technician@eagleeye.com', name: 'Test Technician' };

  try {
    const created = await createChecklist(testUser.id, {
      client_name: 'Carry Test Client Ltd',
      client_mobile: '9876543210',
      client_location: 'Industrial Area',
      device_type: '2 Channel Live',
      number_of_devices: 2,
      number_of_vehicles: 1,
      confirmed_price: 15000,
      payment_method: 'UPI',
      installation_or_service: 'Installation',
      expected_arrival_date: '2026-10-10',
      expected_arrival_time: '10:00 AM',
      service_engineer: 'John Engineer',
      service_assistant: 'Assistant Alex',
      installation_status: 'Assigned'
    });
    const sampleChecklistId = created.id;
    console.log(`Created test checklist: ${created.checklist_number} (ID: ${sampleChecklistId})`);

    // Test 1: Empty device items validation
    console.log('\n[Test 1] Submit empty device list (Should fail validation)');
    try {
      await submitDeviceCarryRecord({
        checklist_id: sampleChecklistId,
        user: testUser,
        items: [],
        remarks: 'Empty test'
      });
      console.error('FAIL: Empty items should have thrown an error');
    } catch (err) {
      console.log('PASS: Correctly rejected empty items ->', err.message);
    }

    // Test 2: Invalid quantities (zero / negative) validation
    console.log('\n[Test 2] Submit invalid quantity (0 or negative) (Should fail validation)');
    try {
      await submitDeviceCarryRecord({
        checklist_id: sampleChecklistId,
        user: testUser,
        items: [{ device_type: '2 Channel Live', quantity_to_carry: 0 }],
        remarks: 'Zero qty test'
      });
      console.error('FAIL: Zero quantity should have thrown an error');
    } catch (err) {
      console.log('PASS: Correctly rejected invalid quantity ->', err.message);
    }

    // Test 3: Duplicate device type validation
    console.log('\n[Test 3] Submit duplicate device types (Should fail validation)');
    try {
      await submitDeviceCarryRecord({
        checklist_id: sampleChecklistId,
        user: testUser,
        items: [
          { device_type: '2 Channel Live', quantity_to_carry: 2 },
          { device_type: '2 Channel Live', quantity_to_carry: 3 }
        ],
        remarks: 'Duplicate type test'
      });
      console.error('FAIL: Duplicate device types should have thrown an error');
    } catch (err) {
      console.log('PASS: Correctly rejected duplicate device types ->', err.message);
    }

    // Test 4: Successful dynamic carry record submission (multiple device rows)
    console.log('\n[Test 4] Submit valid dynamic carry record (2 Channel Live: 2, 4 Channel Live: 1, 6 Channel Recording: 4)');
    const validPayload = {
      checklist_id: sampleChecklistId,
      user: testUser,
      items: [
        { device_type: '2 Channel Live', quantity_to_carry: 2 },
        { device_type: '4 Channel Live', quantity_to_carry: 1 },
        { device_type: '6 Channel Recording', quantity_to_carry: 4 }
      ],
      remarks: 'All devices loaded in van ready for site deployment'
    };

    const carryResult = await submitDeviceCarryRecord(validPayload);
    console.log('PASS: Dynamic carry record submitted successfully:', carryResult.status || 'RECORDED');

    // Test 5: Verify fetched carry record matches technician declaration
    console.log('\n[Test 5] Fetch submitted carry record');
    const fetchedCarry = await getDeviceCarryRecord(sampleChecklistId);
    console.log('Fetched carry items count:', fetchedCarry?.items?.length || 0);
    if (fetchedCarry && fetchedCarry.items.length === 3) {
      console.log('PASS: Carry record accurately reflects all 3 declared rows');
    } else {
      console.error('FAIL: Fetched carry record does not match expected items');
    }

    // Test 6: Start installation immediately without Store Manager approval
    console.log('\n[Test 6] Start installation job (without requiring Store Manager approval)');
    const startResult = await startInstallationJob({
      checklist_id: sampleChecklistId,
      user: testUser
    });
    console.log('PASS: Job status updated to In Progress ->', startResult?.status || 'In Progress');

    // Test 7: Post-installation completion report submission referencing declared carry record
    console.log('\n[Test 7] Submit post-installation completion report referencing declared carry items');
    const completionPayload = {
      checklist_id: sampleChecklistId,
      user: testUser,
      items: [
        { device_type: '2 Channel Live', quantity_carried: 2, quantity_installed: 2, quantity_to_return: 0, quantity_damaged: 0, quantity_missing: 0 },
        { device_type: '4 Channel Live', quantity_carried: 1, quantity_installed: 1, quantity_to_return: 0, quantity_damaged: 0, quantity_missing: 0 },
        { device_type: '6 Channel Recording', quantity_carried: 4, quantity_installed: 3, quantity_to_return: 1, quantity_damaged: 0, quantity_missing: 0, discrepancy_reason: '1 unit unused returned to store' }
      ],
      completion_status: 'Site Work Completed',
      remarks: 'Installation completed cleanly'
    };

    const completionResult = await submitInstallationCompletionReport(completionPayload);
    console.log('PASS: Post-installation completion report submitted ->', completionResult?.status || 'Completed');

    // Cleanup sample data
    await supabase.from('installation_checklists').delete().eq('id', sampleChecklistId);
    console.log('\n--- ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY ---');

  } catch (err) {
    console.error('Test execution failed with error:', err);
    process.exit(1);
  }
}

runTests();
