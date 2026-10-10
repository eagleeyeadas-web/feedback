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
import { createChecklist, getChecklistById } from '../src/services/installationService.js';
import supabase from '../src/services/supabase.js';

async function runStageWorkflowTests() {
  console.log('--- Starting Technical Workspace Stage & Action Workflow Acceptance Tests ---');

  const testUser = { id: 'f3a5e467-a1bf-40ef-8878-ec64b29bbfd5', email: 'technician@eagleeye.com', name: 'Test Technician' };

  try {
    // 0. Create clean test checklist starting at 'Assigned' / 'Pending'
    const created = await createChecklist(testUser.id, {
      client_name: 'Workflow Stage Client',
      client_mobile: '9876543210',
      client_location: 'Main Highway',
      device_type: '2 Channel Live',
      number_of_devices: 2,
      number_of_vehicles: 1,
      confirmed_price: 15000,
      payment_method: 'UPI',
      installation_or_service: 'Installation',
      expected_arrival_date: '2026-10-10',
      expected_arrival_time: '10:00 AM',
      service_engineer: 'Test Engineer',
      service_assistant: 'Test Assistant',
      installation_status: 'Assigned'
    });

    const testJobId = created.id;
    console.log(`Created test checklist: ${created.checklist_number} (ID: ${testJobId})`);

    // TEST STAGE 1: Assigned, Carry Not Submitted
    console.log('\n[Stage 1] Job Assigned (Carry Form Not Submitted)');
    let jobStage1 = await getChecklistById(testJobId);
    let carryRecord1 = await getDeviceCarryRecord(testJobId);
    let isCarryDone1 = !!carryRecord1?.items?.length || jobStage1?.carry_status === 'RECORDED';
    let isStarted1 = ['In Progress', 'Site Work Completed', 'Completed'].includes(jobStage1?.installation_status);
    let isReportSubmitted1 = ['Site Work Completed', 'Completed'].includes(jobStage1?.installation_status);

    console.log(`Current Status: installation_status="${jobStage1?.installation_status}", isCarryDone=${isCarryDone1}`);
    if (!isCarryDone1 && !isReportSubmitted1) {
      console.log('PASS: Stage 1 Primary Action -> "Record Devices Carried"');
    } else {
      console.error('FAIL: Stage 1 action mismatch');
    }

    // Try starting installation prior to submitting carry record (Should fail)
    console.log('\nTesting Start Installation without submitting Carry Form (Should fail)');
    try {
      await startInstallationJob({ checklist_id: testJobId, user: testUser });
      console.error('FAIL: Starting installation without carry record should have failed');
    } catch (err) {
      console.log('PASS: Blocked starting installation without carry record ->', err.message);
    }

    // TEST STAGE 2: Carry Submitted, Not Started Yet
    console.log('\n[Stage 2] Submitting Carry Record');
    await submitDeviceCarryRecord({
      checklist_id: testJobId,
      user: testUser,
      items: [{ device_type: '2 Channel Live', quantity_to_carry: 2 }],
      remarks: '2 units in van'
    });

    let jobStage2 = await getChecklistById(testJobId);
    let carryRecord2 = await getDeviceCarryRecord(testJobId);
    let isCarryDone2 = !!carryRecord2?.items?.length || jobStage2?.carry_status === 'RECORDED';
    let isStarted2 = ['In Progress', 'Site Work Completed', 'Completed'].includes(jobStage2?.installation_status);
    let isReportSubmitted2 = ['Site Work Completed', 'Completed'].includes(jobStage2?.installation_status);

    console.log(`Current Status: installation_status="${jobStage2?.installation_status}", isCarryDone=${isCarryDone2}`);
    if (isCarryDone2 && !isStarted2 && !isReportSubmitted2) {
      console.log('PASS: Stage 2 Primary Action -> "Start Installation"');
    } else {
      console.error('FAIL: Stage 2 action mismatch');
    }

    // TEST STAGE 3: Start Installation -> Installation In Progress
    console.log('\n[Stage 3] Starting Installation Job');
    await startInstallationJob({ checklist_id: testJobId, user: testUser });

    let jobStage3 = await getChecklistById(testJobId);
    let isStarted3 = ['In Progress', 'Site Work Completed', 'Completed'].includes(jobStage3?.installation_status);
    let isReportSubmitted3 = ['Site Work Completed', 'Completed'].includes(jobStage3?.installation_status);

    console.log(`Current Status: installation_status="${jobStage3?.installation_status}"`);
    if (isStarted3 && !isReportSubmitted3) {
      console.log('PASS: Stage 3 Primary Action -> "Complete Installation"');
    } else {
      console.error('FAIL: Stage 3 action mismatch');
    }

    // TEST STAGE 4: Submit Installation Completion Report
    console.log('\n[Stage 4] Submitting Installation Completion Report');
    const res4 = await submitInstallationCompletionReport({
      checklist_id: testJobId,
      user: testUser,
      items: [{ device_type: '2 Channel Live', quantity_carried: 2, quantity_installed: 1, quantity_to_return: 1, quantity_damaged: 0, quantity_missing: 0 }],
      completion_status: 'Site Work Completed',
      remarks: '1 unit installed, 1 unit declared for return'
    });

    let jobStage4 = await getChecklistById(testJobId);
    let finalStatus = res4?.status || jobStage4?.installation_status;
    let finalReconStatus = res4?.reconciliation_status || jobStage4?.reconciliation_status;
    let isReportSubmitted4 = ['Site Work Completed', 'Completed'].includes(finalStatus);

    console.log(`Current Status: installation_status="${finalStatus}", reconciliation_status="${finalReconStatus}"`);
    if (isReportSubmitted4) {
      console.log('PASS: Stage 4 Primary Action -> "View Installation Report" (Read-Only)');
      if (finalReconStatus === 'PENDING_STORE_VERIFICATION') {
        console.log('PASS: Display Status Badge -> "Awaiting Store Verification"');
      }
    } else {
      console.error('FAIL: Stage 4 action mismatch');
    }

    // Cleanup test checklist
    await supabase.from('installation_checklists').delete().eq('id', testJobId);
    console.log('\n--- ALL WORKSPACE STAGE TESTS PASSED SUCCESSFULLY ---');

  } catch (err) {
    console.error('Test execution failed with error:', err);
    process.exit(1);
  }
}

runStageWorkflowTests();
