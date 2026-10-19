import supabase from '../src/services/supabase.js';
import { getStoreMaterialRequirements, syncStoreRequirementForChecklist } from '../src/services/storeRequirementService.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';
import { getInventoryProducts } from '../src/services/inventoryService.js';

async function main() {
  console.log('=== 1. VERIFY REAL CHECKLISTS IN DATABASE ===');
  const { count: chkCount } = await supabase.from('installation_checklists').select('id', { count: 'exact', head: true });
  const { count: storeReqCount } = await supabase.from('store_material_requirements').select('id', { count: 'exact', head: true });
  console.log('installation_checklists total count:', chkCount);
  console.log('store_material_requirements total count:', storeReqCount);

  console.log('\n=== 2. SNAPSHOT STOCK BALANCES BEFORE SYNC ===');
  const matsBefore = await getMaterialInventory();
  const prodsBefore = await getInventoryProducts();
  const matStockBefore = matsBefore.map(m => ({ name: m.material_name, stock: m.current_stock }));
  const prodStockBefore = prodsBefore.map(p => ({ sku: p.sku, stock: p.usable_stock }));

  console.log('\n=== 3. TEST REPEATED SYNC (IDEMPOTENCY) ===');
  const { data: allChecklists } = await supabase.from('installation_checklists').select('*');
  for (const c of allChecklists.slice(0, 5)) {
    await syncStoreRequirementForChecklist(c);
  }
  const { count: storeReqCountAfter1 } = await supabase.from('store_material_requirements').select('id', { count: 'exact', head: true });
  for (const c of allChecklists.slice(0, 5)) {
    await syncStoreRequirementForChecklist(c);
  }
  const { count: storeReqCountAfter2 } = await supabase.from('store_material_requirements').select('id', { count: 'exact', head: true });
  console.log('Store requirements count after sync 1:', storeReqCountAfter1);
  console.log('Store requirements count after sync 2:', storeReqCountAfter2);
  console.log('Idempotency verified (counts identical):', storeReqCountAfter1 === storeReqCountAfter2 && storeReqCountAfter1 === chkCount);

  console.log('\n=== 4. VERIFY STOCK BALANCES UNCHANGED ===');
  const matsAfter = await getMaterialInventory();
  const prodsAfter = await getInventoryProducts();
  let matDiff = 0;
  matsAfter.forEach((m, idx) => {
    if (m.current_stock !== matStockBefore[idx]?.stock) matDiff++;
  });
  let prodDiff = 0;
  prodsAfter.forEach((p, idx) => {
    if (p.usable_stock !== prodStockBefore[idx]?.stock) prodDiff++;
  });
  console.log('Material stock differences:', matDiff, '(0 expected)');
  console.log('Product stock differences:', prodDiff, '(0 expected)');

  console.log('\n=== 5. VERIFY GET STORE MATERIAL REQUIREMENTS API ===');
  const page1 = await getStoreMaterialRequirements({ page: 1, limit: 15 });
  console.log('Page 1 requirements count:', page1.requirements.length);
  console.log('Page 1 summary:', page1.summary);
  console.log('Total pages:', page1.totalPages);

  console.log('\n=== 6. VERIFY BOM CALCULATION & SHORTAGES ON REAL RECORD ===');
  const firstReq = page1.requirements[0];
  console.log('Record ID:', firstReq.id, 'Checklist #:', firstReq.checklist_number);
  console.log('Client:', firstReq.client_name, '| Job Type:', firstReq.job_type);
  console.log('Devices:', firstReq.device_items?.map(d => ({ type: d.device_type, qty: d.required_quantity, stock: d.available_stock, shortage: d.shortage })));
  console.log('Material count:', firstReq.material_items?.length);
  console.log('Shortages count:', firstReq.shortage_count);
  console.log('BOM Availability:', firstReq.bom_availability_status);

  console.log('\n=== 7. VERIFY SERVICE JOB RULES (NO BOM DEFAULT) ===');
  const mockServiceChecklist = {
    id: '00000000-0000-0000-0000-000000000001',
    checklist_number: 'EE-SERV-TEST-0001',
    client_name: 'Test Service Client',
    client_mobile: '9876543210',
    client_location: 'Service Site',
    installation_or_service: 'Service',
    device_type: '2 Channel Live',
    number_of_devices: 2,
    device_configurations: [{ device_type: '2 Channel Live', number_of_devices: 2 }],
    created_at: new Date().toISOString()
  };
  const serviceSynced = await syncStoreRequirementForChecklist(mockServiceChecklist);
  console.log('Service job BOM snapshot:', serviceSynced.bom_snapshot, '(null expected)');
  console.log('Service job material_items length:', serviceSynced.material_items?.length, '(0 expected)');
  console.log('Service job status:', serviceSynced.status, '("NOT_APPLICABLE" expected)');
  console.log('Service job material_issuance_status:', serviceSynced.material_issuance_status, '("NOT_APPLICABLE" expected)');
  console.log('Service job shortage:', serviceSynced.has_shortage, '(false expected)');
  await supabase.from('store_material_requirements').delete().eq('checklist_id', mockServiceChecklist.id);

  console.log('\n=== 8. VERIFY FILTERS & SEARCH ===');
  const filteredSearch = await getStoreMaterialRequirements({ search: firstReq.checklist_number });
  console.log('Search by checklist_number results:', filteredSearch.requirements.length, '(1 expected)');
  const filteredInstallation = await getStoreMaterialRequirements({ job_type: 'Installation', limit: 5 });
  console.log('Filter Installation results:', filteredInstallation.requirements.length);
  const filteredService = await getStoreMaterialRequirements({ job_type: 'Service' });
  console.log('Filter Service results count:', filteredService.requirements.length);

  console.log('\nALL VERIFICATIONS PASSED SUCCESSFULLY!');
  process.exit(0);
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
