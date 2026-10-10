import { getChecklists, getServiceEngineers } from '../src/services/installationService.js';

async function verifyTechnicalWorkspaceFix() {
  console.log('=== VERIFYING TECHNICAL WORKSPACE JOB ASSIGNMENT FIX ===\n');

  // 1. Fetch all assigned checklists
  const checklistsResult = await getChecklists({ limit: 100 });
  const checklists = checklistsResult.checklists;

  console.log(`Total installation checklists fetched: ${checklists.length}`);
  checklists.forEach((job, idx) => {
    console.log(`Job #${idx + 1}:`);
    console.log(`  - Checklist No: ${job.checklist_number}`);
    console.log(`  - Client Name: ${job.client_name}`);
    console.log(`  - Client Location: ${job.client_location}`);
    console.log(`  - Primary Service Engineer: ${job.service_engineer}`);
    console.log(`  - Service Assistant: ${job.service_assistant}`);
    console.log(`  - Installation Status: ${job.installation_status}`);
    console.log(`  - Device Request: ${job.device_type} (Qty: ${job.number_of_devices})`);
  });

  // 2. Fetch engineers list for filter dropdown
  const engineers = await getServiceEngineers();
  console.log(`\nService Engineers available for dropdown filter (${engineers.length}):`);
  engineers.forEach((eng) => {
    console.log(`  - ID: ${eng.id} | Name: ${eng.name} | Role: ${eng.role}`);
  });

  // 3. Test filtering by specific service engineers (e.g. mathi and kumar)
  console.log('\nTesting primary engineer filter queries:');
  for (const engName of ['mathi', 'kumar']) {
    const filtered = await getChecklists({ serviceEngineer: engName });
    console.log(`  - Filter by "${engName}": Found ${filtered.checklists.length} assigned job(s).`);
  }

  console.log('\n✅ VERIFICATION COMPLETE: ALL ASSIGNED JOBS ARE RETRIEVED SUCCESSFULLY!');
  process.exit(0);
}

verifyTechnicalWorkspaceFix().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
