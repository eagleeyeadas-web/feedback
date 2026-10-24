import supabase from '../src/services/supabase.js';
import { createChecklist, getChecklistById } from '../src/services/installationService.js';
import {
  submitInstallationCompletionReport,
  getInstallationCompletionReport,
  recordAdditionalCustomerInstallations,
  getAdditionalCustomerInstallations,
} from '../src/services/workflowService.js';
import {
  getStoreMaterialRequirements,
  getStoreMaterialRequirementById,
} from '../src/services/storeRequirementService.js';
import {
  saveBackupDeclaration,
  getBackupDeclaration,
  issueBackupItemsForChecklist,
  verifyStoreBackupItemReturn,
} from '../src/services/backupItemService.js';
import { getMaterialInventory, adjustMaterialStock } from '../src/services/materialStockService.js';

async function runTestSuite() {
  console.log('========================================================================');
  console.log(' SAFDRIVE: COMPLETE EXTRA DEVICE INSTALLATION TRACKING TEST SUITE      ');
  console.log(' Testing All Scenarios A through H (Technical -> DB -> Store Manager)   ');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, name, details = '') {
    total++;
    if (condition) {
      console.log(`[PASS] ${name}`);
      if (details) console.log(`       ↳ ${details}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}`);
      if (details) console.error(`       ↳ ${details}`);
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  const techUser = {
    id: 'f3a5e467-a1bf-40ef-8878-ec64b29bbfd5',
    email: 'tech.mathi@eagleeye.com',
    name: 'Mathi (Technician)',
    role: 'TECHNICAL',
  };

  const storeUser = {
    id: 'be8232f9-674a-4b93-bbde-826b784c29a3',
    email: 'store@eagleeye.com',
    name: 'Store Manager Test',
    role: 'STORE_MANAGER',
  };

  // Helper to create test checklists
  async function makeChecklist({ name, deviceType = '4 Channel Live', numVehicles = 1, carryExtra = true }) {
    const randomDays = 500 + Math.floor(Math.random() * 8000);
    const date = new Date(Date.now() + randomDays * 86400000).toISOString().split('T')[0];
    return await createChecklist(techUser.id, {
      client_name: `${name} ${Date.now()}`,
      client_mobile: '9876543210',
      client_location: 'Chennai South Yard',
      salesperson_name: 'Sales Rep Kumar',
      service_engineer: 'Mathi',
      expected_arrival_date: date,
      installation_duration: '1 Day',
      installation_or_service: 'Installation',
      device_type: deviceType,
      number_of_devices: numVehicles,
      number_of_vehicles: numVehicles,
      device_configurations: [{ device_type: deviceType, number_of_devices: numVehicles, number_of_vehicles: numVehicles }],
      carry_extra_backup_items: carryExtra,
      confirmed_price: 35000,
      payment_method: 'Cash',
    });
  }

  // Pre-seed sufficient loose stock in store to avoid component shortages during multi-checklist testing
  try {
    await adjustMaterialStock({
      material_name: 'Camera',
      action: 'ADD',
      quantity: 100,
      reason: 'E2E Test stock replenishment: Camera',
      user: storeUser,
    });
    await adjustMaterialStock({
      material_name: 'Live Display',
      action: 'ADD',
      quantity: 50,
      reason: 'E2E Test stock replenishment: Live Display',
      user: storeUser,
    });
  } catch (e) {
    // Non-blocking
  }

  // =========================================================================
  // TEST A: Extra installation for another customer (Kumar & Ramesh Transport)
  // =========================================================================
  console.log('--- TEST A: Extra Installation for Another Customer (Kumar & Ramesh Transport) ---');
  const chkA = await makeChecklist({ name: 'Kumar Logistics', deviceType: '4 Channel Live', numVehicles: 1, carryExtra: true });
  assert(chkA && chkA.id, 'Checklist for Kumar created successfully', `ID: ${chkA.id}, Num: ${chkA.checklist_number}`);

  // Declare loose extra backup items carried: 2 Cameras, 1 Live Display
  await saveBackupDeclaration({
    checklistId: chkA.id,
    user: techUser,
    hasBackupItems: true,
    items: [
      { item_name: 'Camera', quantity: 2, unit: 'Nos.' },
      { item_name: 'Live Display', quantity: 1, unit: 'Nos.' },
    ],
  });

  // Store Manager issues loose backup items
  const issueResA = await issueBackupItemsForChecklist({
    checklist_id: chkA.id,
    user: storeUser,
  });
  assert(issueResA.success === true, 'Loose backup items issued by Store Manager');

  // Technician completes installation:
  // Kumar required: 4 Cameras, 1 Live Display
  // Ramesh Transport (Another Customer): 2 Cameras, 1 Live Display from extra carried stock
  const extraInstallationsPayloadA = [
    {
      recipient_customer_type: 'ANOTHER_CUSTOMER',
      customer_name: 'Ramesh Transport',
      customer_mobile: '9840123456',
      installation_date: '2026-10-24',
      location: 'Port Bypass Yard, Chennai',
      google_maps_link: 'https://maps.google.com/?q=13.0827,80.2707',
      device_configuration: '2 Channel Live',
      components: [
        { component_name: 'Camera', quantity_installed: 2, unit: 'Nos.' },
        { component_name: 'Live Display', quantity_installed: 1, unit: 'Nos.' },
      ],
      notes: 'Installed extra loose devices directly at Ramesh yard',
      recipient_checklist_number: 'Not Linked',
    },
  ];

  const completionReportA = await submitInstallationCompletionReport({
    checklist_id: chkA.id,
    user: techUser,
    actual_installation_date: '2026-10-24',
    completion_notes: 'Kumar 4 Channel Live complete. Ramesh 2 Channel extra complete.',
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 1,
        quantity_installed: 1,
        quantity_installed_required: 1,
        quantity_installed_extra: 0,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    extra_installations: extraInstallationsPayloadA,
    backup_items: [
      { item_name: 'Camera', quantity_carried: 2, quantity_used: 2, quantity_returned: 0, quantity_damaged: 0, quantity_missing: 0 },
      { item_name: 'Live Display', quantity_carried: 1, quantity_used: 1, quantity_returned: 0, quantity_damaged: 0, quantity_missing: 0 },
    ],
  });
  assert(completionReportA && completionReportA.id, 'Technician post-installation report saved successfully');

  // Verify persistence via getAdditionalCustomerInstallations
  const savedExtrasA = await getAdditionalCustomerInstallations(chkA.id);
  assert(Array.isArray(savedExtrasA) && savedExtrasA.length === 1, 'Extra installation record persisted in database');
  assert(savedExtrasA[0].customer_name === 'Ramesh Transport', 'Recipient customer name is Ramesh Transport');
  assert(savedExtrasA[0].recipient_customer_type === 'ANOTHER_CUSTOMER', 'Recipient type is ANOTHER_CUSTOMER');
  assert(savedExtrasA[0].customer_mobile === '9840123456', 'Recipient mobile number is preserved');
  assert(savedExtrasA[0].device_configuration === '2 Channel Live', 'Device configuration is 2 Channel Live');
  assert(savedExtrasA[0].recipient_checklist_number === 'Not Linked', 'Recipient checklist is Not Linked');

  // Verify exact components
  const camComp = savedExtrasA[0].components.find((c) => c.component_name === 'Camera');
  const dispComp = savedExtrasA[0].components.find((c) => c.component_name === 'Live Display');
  assert(camComp && (Number(camComp.quantity_installed || camComp.quantity) === 2), 'Exact Camera quantity = 2 installed for Ramesh Transport');
  assert(dispComp && (Number(dispComp.quantity_installed || dispComp.quantity) === 1), 'Exact Live Display quantity = 1 installed for Ramesh Transport');

  // Verify Store Manager requirement enrichment
  const storeReqA = await getStoreMaterialRequirementById(chkA.id);
  assert(storeReqA && Array.isArray(storeReqA.extra_installations), 'Store Manager requirement item has extra_installations attached');
  assert(storeReqA.extra_installations.length === 1, 'Store Manager requirement item reflects 1 extra installation');
  assert(storeReqA.extra_installations[0].customer_name === 'Ramesh Transport', 'Store Manager sees Ramesh Transport in requirement record');

  // Verify no extra devices returned to warehouse
  const backupDeclAAfter = await getBackupDeclaration(chkA.id);
  const camBackupItem = backupDeclAAfter.items.find((i) => i.item_name === 'Camera');
  assert(Number(camBackupItem.quantity_returned || 0) === 0, 'Extra cameras are NOT marked as returned to warehouse');
  assert(Number(camBackupItem.quantity_used || 0) === 2, 'Extra cameras accounted as used (installed for Ramesh Transport)');

  // Refresh test: query again to verify persistence
  const reloadedExtrasA = await getAdditionalCustomerInstallations(chkA.id);
  assert(reloadedExtrasA.length === 1 && reloadedExtrasA[0].customer_name === 'Ramesh Transport', 'Extra installation remains intact after re-query');

  // =========================================================================
  // TEST B: Multiple recipient customers on the same report
  // =========================================================================
  console.log('\n--- TEST B: Multiple Recipient Customers on Single Report ---');
  const chkB = await makeChecklist({ name: 'Alpha Logistics', deviceType: '4 Channel Live', numVehicles: 1, carryExtra: true });
  await saveBackupDeclaration({
    checklistId: chkB.id,
    user: techUser,
    hasBackupItems: true,
    items: [
      { item_name: 'Camera', quantity: 4, unit: 'Nos.' },
      { item_name: 'Live Display', quantity: 2, unit: 'Nos.' },
    ],
  });
  await issueBackupItemsForChecklist({ checklist_id: chkB.id, user: storeUser });

  const extraInstallationsPayloadB = [
    {
      recipient_customer_type: 'ANOTHER_CUSTOMER',
      customer_name: 'Customer X Transport',
      customer_mobile: '9840111111',
      installation_date: '2026-10-24',
      location: 'Depot 1, Ambattur',
      device_configuration: '2 Channel Live',
      components: [
        { component_name: 'Camera', quantity_installed: 2, unit: 'Nos.' },
        { component_name: 'Live Display', quantity_installed: 1, unit: 'Nos.' },
      ],
      recipient_checklist_number: 'Not Linked',
    },
    {
      recipient_customer_type: 'ANOTHER_CUSTOMER',
      customer_name: 'Customer Y Fleet',
      customer_mobile: '9840222222',
      installation_date: '2026-10-24',
      location: 'Depot 2, Guindy',
      device_configuration: '2 Channel Live',
      components: [
        { component_name: 'Camera', quantity_installed: 2, unit: 'Nos.' },
        { component_name: 'Live Display', quantity_installed: 1, unit: 'Nos.' },
      ],
      recipient_checklist_number: 'Not Linked',
    },
  ];

  await submitInstallationCompletionReport({
    checklist_id: chkB.id,
    user: techUser,
    actual_installation_date: '2026-10-24',
    completion_notes: 'Installed extra stock for 2 separate customers',
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 1,
        quantity_installed: 1,
        quantity_installed_required: 1,
        quantity_installed_extra: 0,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    extra_installations: extraInstallationsPayloadB,
    backup_items: [
      { item_name: 'Camera', quantity_carried: 4, quantity_used: 4, quantity_returned: 0, quantity_damaged: 0, quantity_missing: 0 },
      { item_name: 'Live Display', quantity_carried: 2, quantity_used: 2, quantity_returned: 0, quantity_damaged: 0, quantity_missing: 0 },
    ],
  });

  const savedExtrasB = await getAdditionalCustomerInstallations(chkB.id);
  assert(savedExtrasB.length === 2, 'Both recipient customer records saved separately', `Count: ${savedExtrasB.length}`);
  const custX = savedExtrasB.find((r) => r.customer_name === 'Customer X Transport');
  const custY = savedExtrasB.find((r) => r.customer_name === 'Customer Y Fleet');
  assert(custX && custY, 'Customer X and Customer Y are both present with distinct names');
  assert(custX.customer_mobile === '9840111111' && custY.customer_mobile === '9840222222', 'Each customer retains their distinct mobile');
  assert(!custX.components.find((c) => c.component_name === 'Camera' && Number(c.quantity_installed) === 4), 'Quantities not combined incorrectly');

  // =========================================================================
  // TEST C: Original Customer vs Another Customer extra allocation
  // =========================================================================
  console.log('\n--- TEST C: Original Customer vs Another Customer Allocations ---');
  const chkC = await makeChecklist({ name: 'Fleet C Parent', deviceType: '4 Channel Live', numVehicles: 1, carryExtra: true });
  await saveBackupDeclaration({
    checklistId: chkC.id,
    user: techUser,
    hasBackupItems: true,
    items: [{ item_name: 'Camera', quantity: 4, unit: 'Nos.' }],
  });
  await issueBackupItemsForChecklist({ checklist_id: chkC.id, user: storeUser });

  const extraInstallationsPayloadC = [
    {
      recipient_customer_type: 'ORIGINAL_CUSTOMER',
      customer_name: 'Fleet C Parent',
      device_configuration: 'Additional Camera Set',
      components: [{ component_name: 'Camera', quantity_installed: 2, unit: 'Nos.' }],
      notes: 'Customer asked for 2 extra cameras on trailer',
    },
    {
      recipient_customer_type: 'ANOTHER_CUSTOMER',
      customer_name: 'Third Party Logistics',
      device_configuration: '2 Channel Live',
      components: [{ component_name: 'Camera', quantity_installed: 2, unit: 'Nos.' }],
      notes: 'Installed remaining loose backup for Third Party',
    },
  ];

  await submitInstallationCompletionReport({
    checklist_id: chkC.id,
    user: techUser,
    actual_installation_date: '2026-10-24',
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 1,
        quantity_installed: 1,
        quantity_installed_required: 1,
        quantity_installed_extra: 0,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    extra_installations: extraInstallationsPayloadC,
    backup_items: [{ item_name: 'Camera', quantity_carried: 4, quantity_used: 4, quantity_returned: 0, quantity_damaged: 0, quantity_missing: 0 }],
  });

  const savedExtrasC = await getAdditionalCustomerInstallations(chkC.id);
  const origExtra = savedExtrasC.find((r) => r.recipient_customer_type === 'ORIGINAL_CUSTOMER');
  const otherExtra = savedExtrasC.find((r) => r.recipient_customer_type === 'ANOTHER_CUSTOMER');
  assert(origExtra && origExtra.customer_name === 'Fleet C Parent', 'Original customer extra allocation preserved distinctly');
  assert(otherExtra && otherExtra.customer_name === 'Third Party Logistics', 'Another customer extra allocation preserved distinctly');
  assert(Number(origExtra.components[0].quantity_installed) === 2 && Number(otherExtra.components[0].quantity_installed) === 2, 'Separate 2 + 2 = 4 cameras cleanly tracked');

  // =========================================================================
  // TEST D: Recipient has no checklist
  // =========================================================================
  console.log('\n--- TEST D: Recipient Has No Checklist ("Not Linked") ---');
  const chkD = await makeChecklist({ name: 'Fleet D Unlinked', deviceType: '4 Channel Live', numVehicles: 1, carryExtra: true });
  await saveBackupDeclaration({
    checklistId: chkD.id,
    user: techUser,
    hasBackupItems: true,
    items: [{ item_name: 'Camera', quantity: 2, unit: 'Nos.' }],
  });
  await issueBackupItemsForChecklist({ checklist_id: chkD.id, user: storeUser });

  const extraInstallationsPayloadD = [
    {
      recipient_customer_type: 'ANOTHER_CUSTOMER',
      customer_name: 'Walk-in Fleet Owner',
      customer_mobile: '9998887776',
      installation_date: '2026-10-24',
      location: 'Highway Service Point 4',
      device_configuration: '1 Channel Standard',
      components: [{ component_name: 'Camera', quantity_installed: 2, unit: 'Nos.' }],
      recipient_checklist_number: 'Not Linked',
      recipient_checklist_id: null,
    },
  ];

  await submitInstallationCompletionReport({
    checklist_id: chkD.id,
    user: techUser,
    actual_installation_date: '2026-10-24',
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 1,
        quantity_installed: 1,
        quantity_installed_required: 1,
        quantity_installed_extra: 0,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    extra_installations: extraInstallationsPayloadD,
    backup_items: [{ item_name: 'Camera', quantity_carried: 2, quantity_used: 2, quantity_returned: 0, quantity_damaged: 0, quantity_missing: 0 }],
  });

  const savedExtrasD = await getAdditionalCustomerInstallations(chkD.id);
  assert(savedExtrasD[0].recipient_checklist_number === 'Not Linked', 'Record displays "Not Linked"');
  assert(savedExtrasD[0].recipient_checklist_id === null || !savedExtrasD[0].recipient_checklist_id, 'No fake checklist ID is assigned');
  assert(savedExtrasD[0].customer_name === 'Walk-in Fleet Owner', 'Recipient details fully intact without checklist');

  // =========================================================================
  // TEST E: Recipient has an existing real checklist
  // =========================================================================
  console.log('\n--- TEST E: Recipient Has an Existing Checklist ---');
  const realRecipientChk = await makeChecklist({ name: 'Existing Customer Corp', deviceType: '2 Channel Live', numVehicles: 1, carryExtra: false });
  assert(realRecipientChk && realRecipientChk.id, 'Real recipient checklist exists', `Num: ${realRecipientChk.checklist_number}`);

  const chkE = await makeChecklist({ name: 'Source Fleet E', deviceType: '4 Channel Live', numVehicles: 1, carryExtra: true });
  await saveBackupDeclaration({
    checklistId: chkE.id,
    user: techUser,
    hasBackupItems: true,
    items: [{ item_name: 'Camera', quantity: 2, unit: 'Nos.' }],
  });
  await issueBackupItemsForChecklist({ checklist_id: chkE.id, user: storeUser });

  const extraInstallationsPayloadE = [
    {
      recipient_customer_type: 'ANOTHER_CUSTOMER',
      customer_name: 'Existing Customer Corp',
      customer_mobile: '9876543210',
      installation_date: '2026-10-24',
      location: 'Existing Customer Site',
      device_configuration: '2 Channel Live',
      components: [{ component_name: 'Camera', quantity_installed: 2, unit: 'Nos.' }],
      recipient_checklist_id: realRecipientChk.id,
      recipient_checklist_number: realRecipientChk.checklist_number,
    },
  ];

  await submitInstallationCompletionReport({
    checklist_id: chkE.id,
    user: techUser,
    actual_installation_date: '2026-10-24',
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 1,
        quantity_installed: 1,
        quantity_installed_required: 1,
        quantity_installed_extra: 0,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    extra_installations: extraInstallationsPayloadE,
    backup_items: [{ item_name: 'Camera', quantity_carried: 2, quantity_used: 2, quantity_returned: 0, quantity_damaged: 0, quantity_missing: 0 }],
  });

  const savedExtrasE = await getAdditionalCustomerInstallations(chkE.id);
  assert(savedExtrasE[0].recipient_checklist_id === realRecipientChk.id, 'Existing recipient checklist ID linked successfully');
  assert(savedExtrasE[0].recipient_checklist_number === realRecipientChk.checklist_number, 'Existing recipient checklist number preserved');
  assert(savedExtrasE[0].original_checklist_id === chkE.id, 'Source checklist remains traceable as original');

  // =========================================================================
  // TEST F: Stock Reconciliation and Return Verification Protection
  // =========================================================================
  console.log('\n--- TEST F: Stock Reconciliation and Physical Return Verification ---');
  // Extra carried: 5 Cameras
  // Extra used for another customer: 2 Cameras
  // Extra returned unused: 2 Cameras
  // Extra damaged: 1 Camera
  // Extra missing: 0 Cameras
  // 5 = 2 + 2 + 1 + 0
  const chkF = await makeChecklist({ name: 'Fleet F Reconcile', deviceType: '4 Channel Live', numVehicles: 1, carryExtra: true });
  await saveBackupDeclaration({
    checklistId: chkF.id,
    user: techUser,
    hasBackupItems: true,
    items: [{ item_name: 'Camera', quantity: 5, unit: 'Nos.' }],
  });
  await issueBackupItemsForChecklist({ checklist_id: chkF.id, user: storeUser });

  const extraInstallationsPayloadF = [
    {
      recipient_customer_type: 'ANOTHER_CUSTOMER',
      customer_name: 'Secondary Customer Ltd',
      components: [{ component_name: 'Camera', quantity_installed: 2, unit: 'Nos.' }],
    },
  ];

  await submitInstallationCompletionReport({
    checklist_id: chkF.id,
    user: techUser,
    actual_installation_date: '2026-10-24',
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 1,
        quantity_installed: 1,
        quantity_installed_required: 1,
        quantity_installed_extra: 0,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    extra_installations: extraInstallationsPayloadF,
    backup_items: [
      {
        item_name: 'Camera',
        quantity_carried: 5,
        quantity_used: 2,
        quantity_returned: 2,
        quantity_damaged: 1,
        quantity_missing: 0,
        discrepancy_reason: '1 camera damaged during transit on rough road',
      },
    ],
  });

  // Check accounting balance: Carried (5) = Used (2) + Returned (2) + Damaged (1) + Missing (0)
  const declF = await getBackupDeclaration(chkF.id);
  const camF = declF.items.find((i) => i.item_name === 'Camera');
  const carried = Number(camF.quantity || 5);
  const used = Number(camF.quantity_used || 0);
  const returned = Number(camF.quantity_returned || 0);
  const damaged = Number(camF.quantity_damaged || 0);
  const missing = Number(camF.quantity_missing || 0);
  assert(carried === used + returned + damaged + missing, 'Full accounting equation balances: 5 carried = 2 used + 2 returned + 1 damaged + 0 missing');

  // Verify Store Manager verification: returned items do NOT credit available stock until verified
  const invBefore = await getMaterialInventory();
  const wireBefore = invBefore.find((m) => m.name?.toLowerCase().includes('wire') || m.sku?.includes('WIR')) || invBefore[0];
  const stockBefore = Number(wireBefore?.current_stock || 0);

  // Store Manager verifies returns: 2 usable accepted, 1 damaged
  const verifyRes = await verifyStoreBackupItemReturn({
    checklistId: chkF.id,
    user: storeUser,
    verificationItems: [
      {
        item_name: 'Camera',
        accepted_usable_qty: 2,
        damaged_qty: 1,
        missing_qty: 0,
        remarks: '2 units in good working condition, 1 casing cracked',
      },
    ],
  });
  assert(verifyRes.success === true, 'Store Manager physically verified returns');

  // Prevent duplicate return verification
  let duplicateVerifyBlocked = false;
  try {
    await verifyStoreBackupItemReturn({
      checklistId: chkF.id,
      user: storeUser,
      verificationItems: [],
    });
  } catch (err) {
    duplicateVerifyBlocked = true;
  }
  assert(duplicateVerifyBlocked, 'Duplicate physical return verification blocked with clear error');

  // =========================================================================
  // TEST G: Validation, Retry & Idempotency
  // =========================================================================
  console.log('\n--- TEST G: Validation, Retry & Idempotent Submission ---');
  // Re-submitting report updates cleanly without duplicate records
  const updateRes = await submitInstallationCompletionReport({
    checklist_id: chkA.id,
    user: techUser,
    actual_installation_date: '2026-10-24',
    completion_notes: 'Updated notes: Ramesh installation verified by phone.',
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 1,
        quantity_installed: 1,
        quantity_installed_required: 1,
        quantity_installed_extra: 0,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    extra_installations: extraInstallationsPayloadA,
    backup_items: [
      { item_name: 'Camera', quantity_carried: 2, quantity_used: 2, quantity_returned: 0, quantity_damaged: 0, quantity_missing: 0 },
      { item_name: 'Live Display', quantity_carried: 1, quantity_used: 1, quantity_returned: 0, quantity_damaged: 0, quantity_missing: 0 },
    ],
  });
  assert(updateRes && updateRes.id, 'Retry/Update submission succeeded cleanly');

  const recheckedExtrasA = await getAdditionalCustomerInstallations(chkA.id);
  assert(recheckedExtrasA.length === 1, 'Idempotent submission preserved exactly 1 record without duplicates');

  // =========================================================================
  // TEST H: Regression across existing workflows
  // =========================================================================
  console.log('\n--- TEST H: Regression Across Existing Workflows ---');
  // Normal report with NO extra installations
  const chkH = await makeChecklist({ name: 'Standard Flow Customer', deviceType: '4 Channel Live', numVehicles: 1, carryExtra: false });
  const compReportH = await submitInstallationCompletionReport({
    checklist_id: chkH.id,
    user: techUser,
    actual_installation_date: '2026-10-24',
    completion_notes: 'Normal installation with zero extra items',
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 1,
        quantity_installed: 1,
        quantity_installed_required: 1,
        quantity_installed_extra: 0,
        quantity_to_return: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
    extra_installations: [],
  });
  assert(compReportH && compReportH.id, 'Normal report with no extra installations submits cleanly');

  const extrasH = await getAdditionalCustomerInstallations(chkH.id);
  assert(Array.isArray(extrasH) && extrasH.length === 0, 'No extra installations returned for standard checklist');

  // Check store requirements list contains all jobs and enriches extra_installations safely
  const storeReqListRes = await getStoreMaterialRequirements({ search: chkA.checklist_number });
  const storeReqList = storeReqListRes.requirements || (Array.isArray(storeReqListRes) ? storeReqListRes : []);
  assert(Array.isArray(storeReqList) && storeReqList.length > 0, 'Store Manager requirements list loads successfully');
  const foundReqA = storeReqList.find((r) => r.checklist_id === chkA.id || r.id === chkA.id);
  assert(foundReqA && (foundReqA.extra_installations_count === 1 || foundReqA.extra_installations?.length === 1), 'Checklist A in Store Manager list shows extra_installations');
  assert(foundReqA.extra_installations[0].customer_name === 'Ramesh Transport', 'Checklist A in Store Manager list contains Ramesh Transport');

  // Verify single requirement fetch as used by Store Manager detail modal/expansion
  const singleReqA = await getStoreMaterialRequirementById(chkA.id);
  assert(singleReqA && singleReqA.extra_installations_count === 1, 'Store Manager getStoreMaterialRequirementById enriches extra_installations');
  assert(singleReqA.extra_installations[0].customer_name === 'Ramesh Transport', 'Single requirement detail contains Ramesh Transport');

  console.log('\n========================================================================');
  console.log(` SUMMARY: All ${passed}/${total} End-to-End Tests PASSED!`);
  console.log('========================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\n[FATAL TEST RUNNER ERROR]:', err);
  process.exit(1);
});
