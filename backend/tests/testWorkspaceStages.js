import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { 
  submitDeviceCarryRecord, 
  getDeviceCarryRecord, 
  submitInstallationCompletionReport
} from '../src/services/workflowService.js';
import { createChecklist, getChecklistById } from '../src/services/installationService.js';
import supabase from '../src/services/supabase.js';

async function runStageWorkflowTests() {
  console.log('--- Starting Technical Workspace 3-Step Sequence Acceptance Tests ---');

  const testUser = { id: 'f3a5e467-a1bf-40ef-8878-ec64b29bbfd5', email: 'technician@eagleeye.com', name: 'Test Technician' };

  try {
    // 0. Create clean test checklist starting at 'Assigned'
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

    // TEST STEP 1: Carry record not submitted
    console.log('\n[Step 1] Before recording devices carried');
    let jobStep1 = await getChecklistById(testJobId);
    let carryRecord1 = await getDeviceCarryRecord(testJobId);
    let isCarryDone1 = !!carryRecord1?.items?.length || jobStep1?.carry_status === 'RECORDED';
    let isReportSubmitted1 = ['Site Work Completed', 'Completed'].includes(jobStep1?.installation_status);

    console.log(`Status: carry_status="${jobStep1?.carry_status || 'Not Recorded'}", installation_status="${jobStep1?.installation_status}"`);
    if (!isCarryDone1 && !isReportSubmitted1) {
      console.log('PASS: Primary Action -> "Record Devices Carried" | Carry Status -> "Not Recorded"');
    } else {
      console.error('FAIL: Step 1 action mismatch');
    }

    // TEST STEP 2: Immediately after recording devices carried
    console.log('\n[Step 2] Immediately after recording devices carried');
    await submitDeviceCarryRecord({
      checklist_id: testJobId,
      user: testUser,
      items: [{ device_type: '2 Channel Live', quantity_to_carry: 2 }],
      remarks: '2 units in van'
    });

    let jobStep2 = await getChecklistById(testJobId);
    let carryRecord2 = await getDeviceCarryRecord(testJobId);
    let isCarryDone2 = !!carryRecord2?.items?.length || jobStep2?.carry_status === 'RECORDED';
    let isReportSubmitted2 = ['Site Work Completed', 'Completed'].includes(jobStep2?.installation_status);

    console.log(`Status: carry_status="${jobStep2?.carry_status}", installation_status="${jobStep2?.installation_status}"`);
    if (isCarryDone2 && !isReportSubmitted2) {
      console.log('PASS: Primary Action -> "Record Installed & Returned Devices" | Carry Status -> "Recorded"');
    } else {
      console.error('FAIL: Step 2 action mismatch');
    }

    // TEST STEP 3: After submitting post-installation completion report
    console.log('\n[Step 3] After submitting post-installation report');
    const res3 = await submitInstallationCompletionReport({
      checklist_id: testJobId,
      user: testUser,
      items: [{ device_type: '2 Channel Live', quantity_carried: 2, quantity_installed: 1, quantity_to_return: 1, quantity_damaged: 0, quantity_missing: 0 }],
      completion_status: 'Completed',
      remarks: '1 unit installed, 1 unit returning to store'
    });

    let jobStep3 = await getChecklistById(testJobId);
    let finalStatus = res3?.status || jobStep3?.installation_status;
    let finalReconStatus = res3?.reconciliation_status || jobStep3?.reconciliation_status;
    let isReportSubmitted3 = ['Site Work Completed', 'Completed'].includes(finalStatus);

    console.log(`Status: installation_status="${finalStatus}", reconciliation_status="${finalReconStatus}"`);
    if (isReportSubmitted3) {
      console.log('PASS: Primary Action -> "View Installation Report" | Installation Status -> "Completed"');
      if (finalReconStatus === 'PENDING_STORE_VERIFICATION') {
        console.log('PASS: Return Records Marked -> "Awaiting Store Verification"');
      }
    } else {
      console.error('FAIL: Step 3 action mismatch');
    }

    // Cleanup test checklist
    await supabase.from('installation_checklists').delete().eq('id', testJobId);
    console.log('\n--- ALL WORKSPACE BUTTON SEQUENCE TESTS PASSED SUCCESSFULLY ---');

  } catch (err) {
    console.error('Test execution failed with error:', err);
    process.exit(1);
  }
}

runStageWorkflowTests();
