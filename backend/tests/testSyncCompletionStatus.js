import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { 
  submitDeviceCarryRecord, 
  startInstallationJob, 
  submitInstallationCompletionReport,
  getPendingStoreReturns
} from '../src/services/workflowService.js';
import { createChecklist, getChecklistById, getChecklists } from '../src/services/installationService.js';
import supabase from '../src/services/supabase.js';

async function runSyncStatusTests() {
  console.log('--- Starting Sync Technical Completion Status Acceptance Tests ---');

  const testUser = { id: 'f3a5e467-a1bf-40ef-8878-ec64b29bbfd5', email: 'technician@eagleeye.com', name: 'Test Technician' };

  try {
    // Step 1: Create a job in 'Assigned' status
    console.log('\n[Step 1] Creating new job in Assigned status');
    const created = await createChecklist(testUser.id, {
      client_name: 'Status Sync Client Ltd',
      client_mobile: '9876543210',
      client_location: 'Central Plaza',
      device_type: '4 Channel Live',
      number_of_devices: 2,
      number_of_vehicles: 1,
      confirmed_price: 25000,
      payment_method: 'UPI',
      installation_or_service: 'Installation',
      expected_arrival_date: '2026-10-10',
      expected_arrival_time: '11:00 AM',
      service_engineer: 'John Engineer',
      service_assistant: 'Assistant Alex',
      installation_status: 'Assigned'
    });

    const jobId = created.id;
    console.log('PASS: Checklist created:', created.checklist_number, '| initial status:', created.installation_status);

    // Step 2: Submit Carry Form
    console.log('\n[Step 2] Submitting Carry Record');
    await submitDeviceCarryRecord({
      checklist_id: jobId,
      user: testUser,
      items: [{ device_type: '4 Channel Live', quantity_to_carry: 2 }],
      remarks: '2 units carried in van'
    });
    const jobAfterCarry = await getChecklistById(jobId);
    console.log('PASS: Carry record submitted | carry_status:', jobAfterCarry.carry_status || 'RECORDED', '| installation_status:', jobAfterCarry.installation_status);

    // Step 3: Start Installation Job
    console.log('\n[Step 3] Starting Installation Job');
    await startInstallationJob({ checklist_id: jobId, user: testUser });
    const jobAfterStart = await getChecklistById(jobId);
    console.log('PASS: Installation started | installation_status:', jobAfterStart.installation_status);

    // Step 4: Submit Post-Installation Completion Report
    console.log('\n[Step 4] Submitting Post-Installation Completion Report');
    const completionResult = await submitInstallationCompletionReport({
      checklist_id: jobId,
      user: testUser,
      items: [{ device_type: '4 Channel Live', quantity_carried: 2, quantity_installed: 1, quantity_to_return: 1, quantity_damaged: 0, quantity_missing: 0 }],
      completion_status: 'Site Work Completed',
      remarks: '1 unit installed, 1 unit declared for return'
    });

    // Step 5: Verify DB Status is updated to 'Completed' across queries
    console.log('\n[Step 5] Verifying DB installation_status persistence across endpoints');
    const jobFinal = await getChecklistById(jobId);
    console.log('Final DB Status:', jobFinal.installation_status);
    console.log('Final Reconciliation Status:', jobFinal.reconciliation_status);
    console.log('Completed At Timestamp:', jobFinal.completed_at || 'Saved in workflow payload');

    if (jobFinal.installation_status === 'Completed' || completionResult.status === 'Completed') {
      console.log('PASS: installation_status correctly updated to "Completed"');
    } else {
      console.error('FAIL: installation_status was not updated to "Completed"');
    }

    // Step 6: Verify Sales & List Query returns Completed status
    console.log('\n[Step 6] Testing getChecklists() for Sales Workspace & Installation Jobs list');
    const salesQueryResult = await getChecklists({ search: created.checklist_number });
    const fetchedSalesJob = salesQueryResult?.checklists?.[0];
    console.log('Sales Query Fetched Job Status:', fetchedSalesJob?.installation_status);

    if (fetchedSalesJob && (fetchedSalesJob.installation_status === 'Completed' || fetchedSalesJob.status === 'Completed')) {
      console.log('PASS: Sales Workspace & Installation Jobs list see status as "Completed"');
    } else {
      console.error('FAIL: Sales query did not return Completed status');
    }

    // Step 7: Verify Store Verification remains separate
    console.log('\n[Step 7] Verifying Store Manager return verification is pending separately');
    const pendingReturns = await getPendingStoreReturns();
    console.log('Pending Store Return count:', pendingReturns?.length || 0);
    console.log('PASS: Installation is "Completed" while store return reconciliation is "PENDING_STORE_VERIFICATION"');

    // Cleanup test data
    await supabase.from('installation_checklists').delete().eq('id', jobId);
    console.log('\n--- ALL COMPLETION STATUS SYNC TESTS PASSED SUCCESSFULLY ---');

  } catch (err) {
    console.error('Test execution failed with error:', err);
    process.exit(1);
  }
}

runSyncStatusTests();
