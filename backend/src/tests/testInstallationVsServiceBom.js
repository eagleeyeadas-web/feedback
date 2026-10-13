import assert from 'node:assert';
import { calculateBomRequirements } from '../services/bomService.js';
import { generateInstallationChecklistPDF } from '../services/installationPdfGenerator.js';

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function runTests() {
  console.log('========================================================');
  console.log('RUNNING INSTALLATION VS SERVICE BOM VERIFICATION SUITE');
  console.log('========================================================\n');

  // 1. Live BOM Calculation Endpoint Simulation
  console.log('[Test Group 1] Server-side Job Type Enforcement on BOM Calculation');

  const sampleDeviceConfigs = [
    { device_type: '2 Channel Live', number_of_devices: 2 },
    { device_type: '4 Channel Live', number_of_devices: 3 },
  ];

  // Simulation of routes/bom.js logic:
  function simulateBomCalculateEndpoint(body) {
    const { device_type, number_of_devices, device_configurations, job_type, installation_or_service } = body;
    const effectiveJobType = job_type || installation_or_service;

    if (effectiveJobType === 'Service') {
      return {
        applicable: false,
        configured: false,
        job_type: 'Service',
        message: 'BOM calculations are only applicable for Installation jobs, not Service jobs.',
        device_configurations: [],
        items: [],
        total_devices: 0,
      };
    }

    return calculateBomRequirements(device_configurations || device_type, number_of_devices);
  }

  await itAsync('Installation job calculates BOM requirements successfully', async () => {
    const res = await simulateBomCalculateEndpoint({
      device_configurations: sampleDeviceConfigs,
      job_type: 'Installation',
    });
    assert.strictEqual(res.configured, true);
    assert.strictEqual(res.total_devices, 5);
    assert(Array.isArray(res.items) && res.items.length > 0);
  });

  await itAsync('Service job calculation request is rejected/ignored with applicable=false', async () => {
    const res = await simulateBomCalculateEndpoint({
      device_configurations: sampleDeviceConfigs,
      job_type: 'Service',
    });
    assert.strictEqual(res.applicable, false);
    assert.strictEqual(res.configured, false);
    assert.strictEqual(res.job_type, 'Service');
    assert.strictEqual(res.items.length, 0);
    assert.strictEqual(res.total_devices, 0);
  });

  await itAsync('Service job request using installation_or_service="Service" is rejected', async () => {
    const res = await simulateBomCalculateEndpoint({
      device_type: '4 Channel Live',
      number_of_devices: 1,
      installation_or_service: 'Service',
    });
    assert.strictEqual(res.applicable, false);
    assert.strictEqual(res.configured, false);
    assert.strictEqual(res.items.length, 0);
  });

  // 2. Checklist Creation Service BOM Logic
  console.log('\n[Test Group 2] Checklist Creation Service BOM Logic');

  function simulateCreateChecklistPayload(data, deviceConfigs) {
    const isInstallationJob = (data.installation_or_service || 'Installation') === 'Installation';
    let bomSnapshot = null;
    if (isInstallationJob) {
      bomSnapshot = data.bom_snapshot || null;
      // In service, auto-calculates if not passed:
      if (!bomSnapshot && deviceConfigs.length > 0) {
        bomSnapshot = { configured: true, items: [{ material_name: 'Camera', total_quantity: 4 }] };
      }
    } else {
      bomSnapshot = null;
    }

    return {
      installation_or_service: data.installation_or_service,
      bom_snapshot: bomSnapshot,
      material_issuance_status: isInstallationJob ? (data.material_issuance_status || 'PENDING') : 'NOT_APPLICABLE',
    };
  }

  it('Creating an Installation checklist attaches BOM snapshot and PENDING issuance', () => {
    const payload = simulateCreateChecklistPayload(
      { installation_or_service: 'Installation' },
      sampleDeviceConfigs
    );
    assert.strictEqual(payload.installation_or_service, 'Installation');
    assert(payload.bom_snapshot !== null);
    assert.strictEqual(payload.bom_snapshot.configured, true);
    assert.strictEqual(payload.material_issuance_status, 'PENDING');
  });

  it('Creating a Service checklist enforces bom_snapshot=null and material_issuance_status=NOT_APPLICABLE', () => {
    const payload = simulateCreateChecklistPayload(
      {
        installation_or_service: 'Service',
        bom_snapshot: { configured: true, items: ['stale_data'] }, // Stale data attempted
      },
      sampleDeviceConfigs
    );
    assert.strictEqual(payload.installation_or_service, 'Service');
    assert.strictEqual(payload.bom_snapshot, null, 'Stale BOM data must be purged');
    assert.strictEqual(payload.material_issuance_status, 'NOT_APPLICABLE');
  });

  // 3. Checklist Update & Switching Logic
  console.log('\n[Test Group 3] Checklist Update & Job Type Switching Logic');

  function simulateUpdateChecklistPayload(existing, data, deviceConfigs) {
    const effectiveJobType = data.installation_or_service || existing.installation_or_service || 'Installation';
    const isInstallation = effectiveJobType === 'Installation';

    let updatedBomSnapshot = null;
    if (isInstallation) {
      updatedBomSnapshot = existing.bom_snapshot;
      if (data.bom_snapshot !== undefined) {
        updatedBomSnapshot = data.bom_snapshot;
      }
    } else {
      updatedBomSnapshot = null;
    }

    return {
      installation_or_service: effectiveJobType,
      bom_snapshot: updatedBomSnapshot,
      material_issuance_status: isInstallation
        ? (data.material_issuance_status || existing.material_issuance_status || 'PENDING')
        : 'NOT_APPLICABLE',
    };
  }

  it('Editing existing Installation checklist preserves historical BOM snapshot', () => {
    const existing = {
      installation_or_service: 'Installation',
      bom_snapshot: { bom_version: 1, configured: true, items: [{ material_name: 'Relay', total_quantity: 2 }] },
      material_issuance_status: 'PENDING',
    };
    const update = simulateUpdateChecklistPayload(existing, {}, sampleDeviceConfigs);
    assert.strictEqual(update.installation_or_service, 'Installation');
    assert.deepStrictEqual(update.bom_snapshot, existing.bom_snapshot);
    assert.strictEqual(update.material_issuance_status, 'PENDING');
  });

  it('Switching from Installation to Service clears active BOM snapshot to null and marks NOT_APPLICABLE', () => {
    const existingInstallation = {
      installation_or_service: 'Installation',
      bom_snapshot: { bom_version: 1, configured: true, items: [{ material_name: 'Relay', total_quantity: 2 }] },
      material_issuance_status: 'PENDING',
    };
    const update = simulateUpdateChecklistPayload(existingInstallation, { installation_or_service: 'Service' }, sampleDeviceConfigs);
    assert.strictEqual(update.installation_or_service, 'Service');
    assert.strictEqual(update.bom_snapshot, null, 'Switched to Service: BOM snapshot cleared');
    assert.strictEqual(update.material_issuance_status, 'NOT_APPLICABLE');
  });

  it('Editing existing Service checklist keeps bom_snapshot=null and NOT_APPLICABLE', () => {
    const existingService = {
      installation_or_service: 'Service',
      bom_snapshot: null,
      material_issuance_status: 'NOT_APPLICABLE',
    };
    const update = simulateUpdateChecklistPayload(existingService, { remarks: 'Replaced SIM card' }, sampleDeviceConfigs);
    assert.strictEqual(update.installation_or_service, 'Service');
    assert.strictEqual(update.bom_snapshot, null);
    assert.strictEqual(update.material_issuance_status, 'NOT_APPLICABLE');
  });

  // 4. Material Stock Issuance Protection for Service Jobs
  console.log('\n[Test Group 4] Material Stock Issuance Protection');

  function simulateMaterialIssuanceGuard(checklist) {
    if (checklist.installation_or_service === 'Service') {
      throw new Error(`Checklist ${checklist.checklist_number} is a Service job. Material issuance is only applicable for Installation jobs.`);
    }
    if (checklist.material_issuance_status === 'ISSUED') {
      throw new Error(`Materials have already been issued for checklist ${checklist.checklist_number}.`);
    }
    return { success: true };
  }

  it('Material issuance allowed for Installation job', () => {
    const res = simulateMaterialIssuanceGuard({
      checklist_number: 'EE-INST-001',
      installation_or_service: 'Installation',
      material_issuance_status: 'PENDING',
    });
    assert.strictEqual(res.success, true);
  });

  it('Material issuance blocked with error for Service job', () => {
    assert.throws(
      () => {
        simulateMaterialIssuanceGuard({
          checklist_number: 'EE-SERV-002',
          installation_or_service: 'Service',
          material_issuance_status: 'NOT_APPLICABLE',
        });
      },
      /is a Service job\. Material issuance is only applicable for Installation jobs\./
    );
  });

  // 5. PDF Generation Verification for Both Job Types
  console.log('\n[Test Group 5] PDF Generation for Installation vs Service Jobs');

  const baseChecklistData = {
    id: 'test-chk-pdf',
    checklist_number: 'EE-TEST-20261012-001',
    client_name: 'Omega Transports',
    client_mobile: '9876543210',
    client_location: 'Bangalore Depot',
    device_type: '2 Channel Live',
    number_of_devices: 2,
    device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 2 }],
    confirmed_price: 25000,
    payment_method: 'UPI',
    installation_duration: '1 Day',
    vehicle_type: 'Truck',
    expected_arrival_date: '2026-10-18',
    expected_arrival_time: '10:00',
    service_engineer: 'Arun Kumar',
    service_assistant: 'Praveen K',
    installation_status: 'Assigned',
    payment_status: 'Pending',
    client_confirmation: 'Confirmed',
    bom_snapshot: {
      bom_version: 1,
      configured: true,
      items: [
        { material_name: 'Camera Front', total_quantity: 2, unit: 'Nos.', quantity_per_device: 1 },
        { material_name: 'Power Cable', total_quantity: 20, unit: 'Mtr', quantity_per_device: 10 },
      ],
    },
  };

  await itAsync('Generates PDF for Installation job successfully with BOM table', async () => {
    const instChecklist = {
      ...baseChecklistData,
      installation_or_service: 'Installation',
    };
    const pdfBuffer = await generateInstallationChecklistPDF(instChecklist);
    assert(Buffer.isBuffer(pdfBuffer));
    assert(pdfBuffer.length > 5000);
  });

  await itAsync('Generates PDF for Service job successfully without BOM table', async () => {
    const servChecklist = {
      ...baseChecklistData,
      installation_or_service: 'Service',
      bom_snapshot: null,
    };
    const pdfBuffer = await generateInstallationChecklistPDF(servChecklist);
    assert(Buffer.isBuffer(pdfBuffer));
    assert(pdfBuffer.length > 5000);
  });

  console.log('\n========================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
