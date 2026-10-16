import supabase from '../src/services/supabase.js';
import { createChecklist, getChecklistById } from '../src/services/installationService.js';
import {
  saveBackupDeclaration,
  getBackupDeclaration,
  getAvailableBackupProducts,
  issueBackupItemsForChecklist,
  classifyBackupItemCategory,
} from '../src/services/backupItemService.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';

async function runComprehensiveTestSuite() {
  console.log('========================================================================');
  console.log(' PRE-INSTALLATION: EXTRA ITEMS MODAL & TWO-TABLE DECLARATION TEST SUITE ');
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
    id: 'abaff860-05b2-44fa-9139-b14d92e3fa19',
    email: 'tech@eagleeye.com',
    name: 'Guna Technician',
    role: 'TECHNICAL',
  };

  const storeUser = {
    id: 'be8232f9-674a-4b93-bbde-826b784c29a3',
    email: 'store@eagleeye.com',
    name: 'Store Manager Test',
    role: 'STORE_MANAGER',
  };

  // ---------------------------------------------------------------------------
  // TEST 1: Product Catalogue Verification for All 9 Required Materials + Devices
  // ---------------------------------------------------------------------------
  console.log('--- TEST 1: Catalogue Retrieval & Unit Configuration ---');
  const availableProducts = await getAvailableBackupProducts();
  assert(Array.isArray(availableProducts) && availableProducts.length >= 10, 'Products catalogue loaded successfully');

  const requiredMaterials = [
    { name: 'Insulation Tape', expectedUnit: 'Nos.' },
    { name: 'Cable Tie 200mm', expectedUnit: 'Packets' },
    { name: 'Cable Tie 300mm', expectedUnit: 'Packets' },
    { name: 'Long Screw', expectedUnit: 'Nos.' },
    { name: 'Small Screw', expectedUnit: 'Nos.' },
    { name: 'Memory Card', expectedUnit: 'Nos.' },
    { name: '0.5 mm Wire', expectedUnit: 'Metres' },
    { name: '5m Cable', expectedUnit: 'Nos.' },
    { name: '15m Cable', expectedUnit: 'Nos.' },
  ];

  for (const req of requiredMaterials) {
    const matched = availableProducts.find((p) => {
      const pName = (p.item_name || '').toLowerCase();
      const rName = req.name.toLowerCase();
      if (pName === rName) return true;
      if (rName.includes('cable tie 200') && pName.includes('cable tie') && pName.includes('200')) return true;
      if (rName.includes('cable tie 300') && pName.includes('cable tie') && pName.includes('300')) return true;
      if (rName.includes('5m cable') && (pName.includes('5-metre') || pName === '5m cable') && !pName.includes('15')) return true;
      if (rName.includes('15m cable') && (pName.includes('15-metre') || pName === '15m cable')) return true;
      return false;
    });

    assert(
      Boolean(matched),
      `Required material "${req.name}" exists in database catalogue`,
      matched ? `Found: "${matched.item_name}" (${matched.unit})` : 'Missing'
    );
    assert(
      matched && matched.unit === req.expectedUnit,
      `Material "${req.name}" has configured unit "${req.expectedUnit}" from DB`,
      `Actual unit: ${matched?.unit}`
    );
  }

  // Check Extra Device options
  const cameraProduct = availableProducts.find((p) => p.item_name.toLowerCase() === 'camera');
  const liveDisplayProduct = availableProducts.find((p) => p.item_name.toLowerCase().includes('live display'));
  const recDisplayProduct = availableProducts.find((p) => p.item_name.toLowerCase().includes('recording display'));
  assert(Boolean(cameraProduct), 'Extra device "Camera" present in catalogue');
  assert(Boolean(liveDisplayProduct), 'Extra device "Live Display" present in catalogue');
  assert(Boolean(recDisplayProduct), 'Extra device "Recording Display" present in catalogue');

  // ---------------------------------------------------------------------------
  // TEST 2: Creation of Test Checklist
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 2: Create Test Installation Checklist ---');
  const testNow = Date.now();
  const randomDays = 2000 + Math.floor(Math.random() * 20000);
  const dynamicDate = new Date(Date.now() + randomDays * 86400000).toISOString().split('T')[0];
  const checklist = await createChecklist('f3a5e467-a1bf-40ef-8878-ec64b29bbfd5', {
    client_name: `Enterprise Client ${testNow}`,
    client_mobile: '9876543210',
    client_location: 'Central Depot Gate 4',
    salesperson_name: 'Anand',
    service_engineer: 'Guna Technician',
    expected_arrival_date: dynamicDate,
    installation_duration: '1 Day',
    installation_or_service: 'Installation',
    device_type: '4 Channel Live',
    number_of_devices: 3,
    number_of_vehicles: 3,
    device_configurations: [{ device_type: '4 Channel Live', number_of_devices: 3, number_of_vehicles: 3 }],
    carry_extra_backup_items: true,
    confirmed_price: 60000,
    payment_method: 'Bank Transfer',
  });

  assert(checklist && checklist.id, 'Checklist created successfully in PostgreSQL');
  assert(checklist.number_of_devices === 3, 'Customer required devices is strictly 3');

  // ---------------------------------------------------------------------------
  // TEST 3: Validation of Categories Separation
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 3: Category Classification Rules ---');
  assert(classifyBackupItemCategory('Camera') === 'Device Component', 'Camera classified as Device Component');
  assert(classifyBackupItemCategory('Live Display') === 'Device Component', 'Live Display classified as Device Component');
  assert(classifyBackupItemCategory('Recording Display') === 'Device Component', 'Recording Display classified as Device Component');
  assert(classifyBackupItemCategory('Insulation Tape') === 'Installation Material', 'Insulation Tape classified as Installation Material');
  assert(classifyBackupItemCategory('0.5 mm Wire') === 'Installation Material', '0.5 mm Wire classified as Installation Material');
  assert(classifyBackupItemCategory('Cable Tie 200mm') === 'Installation Material', 'Cable Tie 200mm classified as Installation Material');
  assert(classifyBackupItemCategory('5m Cable') === 'Installation Material', '5m Cable classified as Installation Material');

  // ---------------------------------------------------------------------------
  // TEST 4: Both Tables Separately Usable (Only Installation Materials declared)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 4: Independent Tables (Only Materials Declared, Devices Table Empty) ---');
  const materialsOnly = [
    { item_name: 'Insulation Tape', quantity: 3, unit: 'Nos.', category: 'Installation Material' },
    { item_name: 'Cable Tie 200mm', quantity: 2, unit: 'Packets', category: 'Installation Material' },
    { item_name: '0.5 mm Wire', quantity: 25, unit: 'Metres', category: 'Installation Material' },
  ];

  const declMatsOnly = await saveBackupDeclaration({
    checklistId: checklist.id,
    user: techUser,
    hasBackupItems: true,
    items: materialsOnly,
  });

  assert(declMatsOnly && declMatsOnly.items.length === 3, 'Declaration saved with only materials (devices empty)');
  const fetchedMatsOnly = await getBackupDeclaration(checklist.id);
  const materialsCount = fetchedMatsOnly.items.filter((it) => it.category === 'Installation Material').length;
  const devicesCount = fetchedMatsOnly.items.filter((it) => it.category === 'Device Component').length;
  assert(materialsCount === 3 && devicesCount === 0, 'Installation materials persisted without extra devices');

  // ---------------------------------------------------------------------------
  // TEST 5: Both Tables Declared Together (Mixed Extra Devices + Installation Materials)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 5: Dual-Table Declaration (Devices + Materials Saved & Restored) ---');
  const initialInventory = await getMaterialInventory();
  const wireStockInitial = initialInventory.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'))?.current_stock;
  const tapeStockInitial = initialInventory.find((m) => m.material_name.toLowerCase().includes('insulation tape'))?.current_stock;

  const dualTableItems = [
    // Extra Devices Table rows
    { item_name: 'Camera', quantity: 2, unit: 'Nos.', category: 'Device Component' },
    { item_name: 'Display', quantity: 1, unit: 'Nos.', category: 'Device Component' },
    // Installation Materials Table rows
    { item_name: 'Insulation Tape', quantity: 4, unit: 'Nos.', category: 'Installation Material' },
    { item_name: 'Cable Tie 300mm', quantity: 2, unit: 'Packets', category: 'Installation Material' },
    { item_name: '0.5 mm Wire', quantity: 20, unit: 'Metres', category: 'Installation Material' },
    { item_name: '5m Cable', quantity: 3, unit: 'Nos.', category: 'Installation Material' },
  ];

  const dualDecl = await saveBackupDeclaration({
    checklistId: checklist.id,
    user: techUser,
    hasBackupItems: true,
    items: dualTableItems,
  });

  assert(dualDecl && dualDecl.items.length === 6, 'Dual-table declaration saved with 6 line items');
  assert(dualDecl.status === 'CORRECTED', 'Declaration revision recorded as CORRECTED');

  // Re-fetch (simulate reopening the modal)
  const reopenedDecl = await getBackupDeclaration(checklist.id);
  assert(reopenedDecl && reopenedDecl.items.length === 6, 'Declaration reloaded on reopening modal');

  const restoredDevices = reopenedDecl.items.filter((it) => it.category === 'Device Component');
  const restoredMaterials = reopenedDecl.items.filter((it) => it.category === 'Installation Material');

  assert(restoredDevices.length === 2, '2 extra devices accurately restored into Extra Devices table', `${restoredDevices.map((d) => d.item_name).join(', ')}`);
  assert(restoredMaterials.length === 4, '4 materials accurately restored into Installation Materials table', `${restoredMaterials.map((m) => m.item_name).join(', ')}`);

  const reopenedWire = restoredMaterials.find((m) => m.item_name.includes('0.5 mm Wire'));
  assert(reopenedWire && reopenedWire.unit === 'Metres' && Number(reopenedWire.quantity) === 20, 'Wire restored with unit "Metres" and qty 20');

  // ---------------------------------------------------------------------------
  // TEST 6: Inventory Non-Deduction Safeguard (Declaration does NOT deduct stock)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 6: Inventory Non-Deduction Safeguard ---');
  const currentInventory = await getMaterialInventory();
  const wireStockAfter = currentInventory.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'))?.current_stock;
  const tapeStockAfter = currentInventory.find((m) => m.material_name.toLowerCase().includes('insulation tape'))?.current_stock;

  assert(wireStockInitial === wireStockAfter, '0.5 mm Wire stock strictly unchanged (No deduction from declaration alone)');
  assert(tapeStockInitial === tapeStockAfter, 'Insulation Tape stock strictly unchanged (No deduction from declaration alone)');

  // Preliminary BOM & Customer quantities safeguard
  const reloadedChecklist = await getChecklistById(checklist.id);
  assert(reloadedChecklist.number_of_devices === 3, 'Customer required devices remains strictly 3');
  assert(reloadedChecklist.total_devices_carried === 3, 'Total devices carried remains strictly 3 (BOM preliminary count not inflated)');

  // ---------------------------------------------------------------------------
  // TEST 7: Store Manager Authorized Issuance (Deduction ONLY upon Store Issuance)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 7: Authorized Store Manager Issuance ---');
  const issuanceResult = await issueBackupItemsForChecklist({
    checklist_id: checklist.id,
    user: storeUser,
    remarks: 'Store dispatch for site contingency loose items',
  });

  assert(issuanceResult && issuanceResult.success === true, 'Store Manager successfully issued backup items');
  const postIssuanceInventory = await getMaterialInventory();
  const wireStockPostIssue = postIssuanceInventory.find((m) => m.material_name.toLowerCase().includes('0.5 mm wire'))?.current_stock;
  assert(
    wireStockPostIssue === wireStockInitial - 20,
    'Stock deducted 20 Metres of wire ONLY after authorized Store Manager issuance',
    `Initial: ${wireStockInitial}, After issuance: ${wireStockPostIssue}`
  );

  // ---------------------------------------------------------------------------
  // TEST 8: "No Extra Backup Items" Option with Reason Requirement
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 8: No Extra Backup Items Carried Flow ---');
  // 8a: Without reason when Sales expected -> rejected
  try {
    await saveBackupDeclaration({
      checklistId: checklist.id,
      user: techUser,
      hasBackupItems: false,
      noItemsReason: '',
      items: [],
    });
    assert(false, 'Should reject empty reason when Sales expected backup items');
  } catch (err) {
    assert(err.message.includes('provide a reason'), 'Empty reason rejected when Sales expected backup items');
  }

  // 8b: With valid reason -> saved successfully
  const noItemsDecl = await saveBackupDeclaration({
    checklistId: checklist.id,
    user: techUser,
    hasBackupItems: false,
    noItemsReason: 'Stock already available at client facility in Chennai depot.',
    items: [],
  });

  assert(noItemsDecl.has_backup_items === false, '"No extra backup items carried" saved successfully');
  assert(noItemsDecl.no_items_reason.includes('Chennai depot'), 'No-items reason persisted reliably');
  assert(noItemsDecl.items.length === 0, 'Items cleared from active declaration');

  // ---------------------------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------------------------
  console.log('\n--- Cleanup Test Fixtures ---');
  const { adjustMaterialStock } = await import('../src/services/materialStockService.js');
  // Re-add 20 Metres to restore store balance
  await adjustMaterialStock({
    material_name: '0.5 mm Wire',
    action: 'ADD',
    quantity: 20,
    reason: 'Test suite cleanup: restore store balance',
    user: storeUser,
  });

  await supabase.from('installation_checklists').delete().eq('id', checklist.id);
  await supabase.from('engineer_bookings').delete().eq('checklist_id', checklist.id);

  console.log('\n========================================================================');
  console.log(` ALL PRE-INSTALLATION MODAL SUITE TESTS PASSED (${passed}/${total})`);
  console.log('========================================================================\n');
  process.exit(0);
}

runComprehensiveTestSuite().catch((err) => {
  console.error('\nAcceptance test failed with error:', err);
  process.exit(1);
});
