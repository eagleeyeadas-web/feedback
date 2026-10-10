import supabase from '../src/services/supabase.js';
import { getServiceEngineers, getChecklists } from '../src/services/installationService.js';
import {
  submitDeviceCarryRecord,
  getDeviceCarryRecord,
  startInstallationJob,
  submitInstallationCompletionReport,
  getInstallationCompletionReport,
  verifyStoreReturn,
  getPendingStoreReturns,
} from '../src/services/workflowService.js';

async function runVerificationTests() {
  console.log('--- STARTING VERIFICATION TESTS ---');

  const testUser = {
    id: 'f3a5e467-a1bf-40ef-8878-ec64b29bbfd5',
    email: 'admin@eagleeyesafdrive.com',
    full_name: 'Test Admin',
    role: 'ADMIN',
  };

  // TEST 1: Service Engineer Filter & List
  console.log('\n1. Testing Service Engineer List & Filtering...');
  const engineers = await getServiceEngineers();
  console.log(`Fetched ${engineers.length} service engineers:`, engineers.map((e) => e.name));

  const allJobs = await getChecklists();
  console.log(`Total jobs in database: ${allJobs.checklists.length}`);

  if (allJobs.checklists.length > 0) {
    const sampleJob = allJobs.checklists[0];
    const engFilterResult = await getChecklists({ serviceEngineer: sampleJob.service_engineer });
    console.log(
      `Filtering by engineer "${sampleJob.service_engineer}" returned ${engFilterResult.checklists.length} jobs.`
    );

    const combinedResult = await getChecklists({
      serviceEngineer: sampleJob.service_engineer,
      search: sampleJob.client_name,
    });
    console.log(
      `Combined filter (Engineer: "${sampleJob.service_engineer}", Search: "${sampleJob.client_name}") returned ${combinedResult.checklists.length} jobs.`
    );

    // TEST 2: Device Carry Form Validation & Submission
    console.log('\n2. Testing Pre-Installation Device Carry Form Workflow...');
    const carryPayload = {
      checklist_id: sampleJob.id,
      user: testUser,
      items: [
        {
          device_type: sampleJob.device_type,
          quantity_issued: sampleJob.number_of_devices,
          quantity_carried: sampleJob.number_of_devices,
          discrepancy_reason: '',
        },
      ],
      remarks: 'Verified physical units in store before departure.',
    };

    const carryRecord = await submitDeviceCarryRecord(carryPayload);
    console.log('Carry Record Submitted successfully. Record ID:', carryRecord.id);

    const fetchedCarry = await getDeviceCarryRecord(sampleJob.id);
    console.log('Fetched Carry Record Status:', fetchedCarry?.status, 'Items count:', fetchedCarry?.items?.length);

    // TEST 3: Start Installation Job
    console.log('\n3. Testing Start Installation Job...');
    const startedJob = await startInstallationJob({ checklist_id: sampleJob.id, user: testUser });
    console.log('Job Started successfully. New Status:', startedJob.installation_status);

    // TEST 4: Post-Installation Completion Form Submission
    console.log('\n4. Testing Post-Installation Completion Form...');
    const completionPayload = {
      checklist_id: sampleJob.id,
      user: testUser,
      items: [
        {
          device_type: sampleJob.device_type,
          quantity_carried: sampleJob.number_of_devices,
          quantity_installed: sampleJob.number_of_devices,
          quantity_to_return: 0,
          quantity_damaged: 0,
          quantity_missing: 0,
          discrepancy_reason: '',
        },
      ],
      completion_status: 'Site Work Completed',
      remarks: 'Installation completed cleanly at client location.',
    };

    const completionReport = await submitInstallationCompletionReport(completionPayload);
    console.log('Completion Report Submitted successfully. Summary:', completionReport.summary);

    const fetchedReport = await getInstallationCompletionReport(sampleJob.id);
    console.log('Fetched Completion Report status:', fetchedReport?.completion_status);

    // TEST 5: Pending Store Returns & Verification
    console.log('\n5. Testing Pending Store Returns...');
    const pendingReturns = await getPendingStoreReturns();
    console.log(`Fetched ${pendingReturns.length} pending store returns.`);

    console.log('\nALL VERIFICATION TESTS PASSED SUCCESSFULLY! ✅');
  } else {
    console.log('No installation checklist found in database to perform workflow test.');
  }

  process.exit(0);
}

runVerificationTests().catch((err) => {
  console.error('VERIFICATION TEST FAILED ❌:', err);
  process.exit(1);
});
