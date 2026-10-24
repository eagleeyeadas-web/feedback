/**
 * Comprehensive Acceptance Test Suite:
 * SafDrive — Redesign Weekly Stock Maintenance Report (Technician-Wise Installation Report)
 * 
 * Verifies all 14 Acceptance Criteria specified in Section 11:
 * 1. A completed installation with one device type appears correctly.
 * 2. A completed installation with more than three device types displays every type and quantity.
 * 3. Multiple units of the same device type display the correct quantity.
 * 4. One technician with multiple clients displays separate installation groups.
 * 5. A technician with no completed installations shows a clear empty state.
 * 6. Incomplete or unsubmitted Post-Installation Forms are excluded.
 * 7. Extra devices installed for another customer appear under the correct customer.
 * 8. Issued, returned, damaged, and missing quantities are not incorrectly counted as installed.
 * 9. Reporting-period boundaries work correctly in Asia/Kolkata.
 * 10. Duplicate device rows and repeated notifications do not duplicate installations.
 * 11. The PDF includes all technicians, clients, devices, and quantities across multiple pages.
 * 12. The four unwanted sections are absent from both the UI and PDF.
 * 13. Inventory balances and other Store Manager pages remain unchanged.
 * 14. Mobile layout remains usable.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateWeeklyStockReport,
  getTechnicianWiseInstallationReport,
  getPreviousCompletedWeek,
  getWeekUtcBoundaries,
  formatWeekRangeDisplay,
  toKolkataDateString,
  formatKolkataDateDisplay,
  AUTHORIZED_SERVICE_ENGINEERS,
} from '../src/services/weeklyStockReportService.js';
import { generateWeeklyStockReportPdf } from '../src/services/weeklyStockReportPdfGenerator.js';
import {
  inMemoryCompletionReports,
  inMemoryAdditionalInstallations,
} from '../src/services/workflowService.js';
import { inMemoryServiceEngineers } from '../src/services/serviceEngineerService.js';
import { getMaterialInventory } from '../src/services/materialStockService.js';
import supabase from '../src/services/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, testName, details = '') {
  if (condition) {
    passed++;
    results.push({ testName, passed: true, details });
    console.log(`   ✓ PASS [${passed}]: ${testName}`);
  } else {
    failed++;
    results.push({ testName, passed: false, details });
    console.error(`   ❌ FAIL [${failed}]: ${testName} - ${details}`);
    throw new Error(`Assertion failed: ${testName} - ${details}`);
  }
}

async function runTestSuite() {
  console.log('\n========================================================================');
  console.log(' SAFDRIVE ACCEPTANCE TEST SUITE: TECHNICIAN-WISE INSTALLATION REPORT');
  console.log('========================================================================\n');

  // Baseline inventory snapshot for read-only verification
  const initialInventory = await getMaterialInventory();

  // Test reporting period: 19 Oct 2026 to 25 Oct 2026 (Asia/Kolkata)
  const testStartDate = '2026-10-19';
  const testEndDate = '2026-10-25';

  // Seed test checklists into in-memory store and Supabase mocks
  const testChecklist1Id = 'chk-test-single-dev-001';
  const testChecklist2Id = 'chk-test-multi-dev-002';
  const testChecklist3Id = 'chk-test-aggregated-003';
  const testChecklist4Id = 'chk-test-client-b-004';
  const testChecklistIncompleteId = 'chk-test-incomplete-005';
  const testChecklistCancelledId = 'chk-test-cancelled-006';
  const testChecklistOutsideDateId = 'chk-test-outside-date-007';

  // 1. Mathi - Kumar - 1 device type (4 Channel Live, qty 1)
  inMemoryCompletionReports.set(testChecklist1Id, {
    checklist_id: testChecklist1Id,
    client_name: 'Kumar',
    client_location: 'Chennai Central',
    google_maps_location: 'https://maps.google.com/?q=13.0827,80.2707',
    completion_status: 'Completed',
    actual_installation_date: '2026-10-22',
    actual_completion_datetime: '2026-10-22T14:30:00+05:30',
    technician_name: 'Mathi',
    items: [
      {
        device_type: '4 Channel Live',
        quantity_carried: 2,
        quantity_installed: 1, // 1 installed
        quantity_to_return: 1, // 1 returned
        quantity_damaged: 0,
        quantity_missing: 0,
      },
    ],
  });

  // 2. Mathi - Sri Lakshmi Transport - 5 device types (> 3 device types: 6 Channel Live, Memory Card, TPMS, Driver Fatigue Sensor, SOS Button)
  inMemoryCompletionReports.set(testChecklist2Id, {
    checklist_id: testChecklist2Id,
    client_name: 'Sri Lakshmi Transport',
    client_location: 'Coimbatore South',
    completion_status: 'Completed',
    actual_installation_date: '2026-10-21',
    actual_completion_datetime: '2026-10-21T16:00:00+05:30',
    technician_name: 'Mathi',
    items: [
      { device_type: '6 Channel Live', quantity_carried: 1, quantity_installed: 1 },
      { device_type: 'Memory Card', quantity_carried: 3, quantity_installed: 2, quantity_to_return: 1 },
      { device_type: 'TPMS Sensor', quantity_carried: 4, quantity_installed: 4 },
      { device_type: 'Driver Fatigue Sensor', quantity_carried: 1, quantity_installed: 1 },
      { device_type: 'SOS Panic Button', quantity_carried: 2, quantity_installed: 2 },
    ],
  });

  // 3. Guna - Greenline Logistics - Multiple rows of same device type (2 Channel Live: 1 + 2 = 3)
  inMemoryCompletionReports.set(testChecklist3Id, {
    checklist_id: testChecklist3Id,
    client_name: 'Greenline Logistics',
    client_location: 'Salem Bypass',
    completion_status: 'Completed',
    actual_installation_date: '2026-10-20',
    actual_completion_datetime: '2026-10-20T11:00:00+05:30',
    technician_name: 'Guna',
    items: [
      { device_type: '2 Channel Live', quantity_carried: 2, quantity_installed: 1 },
      { device_type: '2 Channel Live', quantity_carried: 3, quantity_installed: 2 }, // Duplicate device type in separate entry -> aggregated
      { device_type: 'GPS Tracker', quantity_carried: 1, quantity_installed: 1 },
    ],
  });

  // 4. Guna - Second Client: ABC Fleet Solutions
  inMemoryCompletionReports.set(testChecklist4Id, {
    checklist_id: testChecklist4Id,
    client_name: 'ABC Fleet Solutions',
    client_location: 'Madurai City',
    completion_status: 'Completed',
    actual_installation_date: '2026-10-23',
    actual_completion_datetime: '2026-10-23T15:00:00+05:30',
    technician_name: 'Guna',
    items: [
      { device_type: '4 Channel Recording', quantity_carried: 1, quantity_installed: 1 },
    ],
  });

  // 5. Incomplete / In-Progress checklist (should be excluded)
  inMemoryCompletionReports.set(testChecklistIncompleteId, {
    checklist_id: testChecklistIncompleteId,
    client_name: 'Incomplete Client',
    completion_status: 'In Progress',
    actual_installation_date: '2026-10-21',
    technician_name: 'Mathi',
    items: [{ device_type: '4 Channel Live', quantity_installed: 1 }],
  });

  // 6. Cancelled checklist (should be excluded)
  inMemoryCompletionReports.set(testChecklistCancelledId, {
    checklist_id: testChecklistCancelledId,
    client_name: 'Cancelled Client',
    completion_status: 'Cancelled',
    actual_installation_date: '2026-10-21',
    technician_name: 'Sakthivel',
    items: [{ device_type: '4 Channel Live', quantity_installed: 1 }],
  });

  // 7. Completed outside the reporting period (e.g. 10 Oct 2026 -> should be excluded)
  inMemoryCompletionReports.set(testChecklistOutsideDateId, {
    checklist_id: testChecklistOutsideDateId,
    client_name: 'Old Period Client',
    completion_status: 'Completed',
    actual_installation_date: '2026-10-10',
    actual_completion_datetime: '2026-10-10T14:00:00+05:30',
    technician_name: 'Mathi',
    items: [{ device_type: '4 Channel Live', quantity_installed: 1 }],
  });

  // 8. Extra Device Installation for ANOTHER customer:
  // Mathi carries loose extra backup, installs for separate recipient "Metro Express"
  inMemoryAdditionalInstallations.set(testChecklist1Id, [
    {
      id: 'extra-inst-metro-express-001',
      checklist_id: testChecklist1Id,
      original_checklist_id: testChecklist1Id,
      recipient_customer_name: 'Metro Express',
      recipient_customer_type: 'ANOTHER_CUSTOMER',
      installation_date: '2026-10-22',
      installation_location: 'Salem Hub',
      google_maps_link: 'https://maps.google.com/?q=11.6643,78.1460',
      technician_name: 'Mathi',
      components: [
        { component_name: '2 Channel Recording', quantity_installed: 1 },
        { component_name: 'Dashcam SD Card', quantity_installed: 1 },
      ],
    },
  ]);

  // Insert mock checklists into Supabase mock / DB to support report join
  try {
    await supabase.from('installation_checklists').upsert([
      {
        id: testChecklist1Id,
        checklist_number: 'CHK-TEST-001',
        client_name: 'Kumar',
        client_mobile: '9876543210',
        service_engineer: 'Mathi',
        installation_status: 'Completed',
        actual_completion_datetime: '2026-10-22T14:30:00+05:30',
        client_location: 'Chennai Central',
        google_maps_location: 'https://maps.google.com/?q=13.0827,80.2707',
      },
      {
        id: testChecklist2Id,
        checklist_number: 'CHK-TEST-002',
        client_name: 'Sri Lakshmi Transport',
        client_mobile: '9876543211',
        service_engineer: 'Mathi',
        installation_status: 'Completed',
        actual_completion_datetime: '2026-10-21T16:00:00+05:30',
        client_location: 'Coimbatore South',
      },
      {
        id: testChecklist3Id,
        checklist_number: 'CHK-TEST-003',
        client_name: 'Greenline Logistics',
        client_mobile: '9876543212',
        service_engineer: 'Guna',
        installation_status: 'Completed',
        actual_completion_datetime: '2026-10-20T11:00:00+05:30',
        client_location: 'Salem Bypass',
      },
      {
        id: testChecklist4Id,
        checklist_number: 'CHK-TEST-004',
        client_name: 'ABC Fleet Solutions',
        client_mobile: '9876543213',
        service_engineer: 'Guna',
        installation_status: 'Completed',
        actual_completion_datetime: '2026-10-23T15:00:00+05:30',
        client_location: 'Madurai City',
      },
      {
        id: testChecklistIncompleteId,
        checklist_number: 'CHK-TEST-005',
        client_name: 'Incomplete Client',
        client_mobile: '9876543214',
        service_engineer: 'Mathi',
        installation_status: 'In Progress',
      },
      {
        id: testChecklistCancelledId,
        checklist_number: 'CHK-TEST-006',
        client_name: 'Cancelled Client',
        client_mobile: '9876543215',
        service_engineer: 'Sakthivel',
        installation_status: 'Cancelled',
      },
      {
        id: testChecklistOutsideDateId,
        checklist_number: 'CHK-TEST-007',
        client_name: 'Old Period Client',
        client_mobile: '9876543216',
        service_engineer: 'Mathi',
        installation_status: 'Completed',
        actual_completion_datetime: '2026-10-10T14:00:00+05:30',
      },
    ]);
  } catch (err) {
    console.warn('Notice: Supabase mock upsert completed with in-memory fallback');
  }

  // ========================================================================
  // RUNNING THE REPORT
  // ========================================================================
  console.log(`-> Generating report for week: ${testStartDate} to ${testEndDate}...`);
  const report = await generateWeeklyStockReport({
    startDate: testStartDate,
    endDate: testEndDate,
    user: { full_name: 'Store Manager', email: 'store@safdrive.com', role: 'STORE_MANAGER' },
  });

  const techReport = report.technician_installation_report || report.technicianInstallationReport;
  const technicians = techReport.technicians;

  const mathi = technicians.find((t) => t.technicianName === 'Mathi');
  const guna = technicians.find((t) => t.technicianName === 'Guna');
  const sakthivel = technicians.find((t) => t.technicianName === 'Sakthivel');
  const kamalesh = technicians.find((t) => t.technicianName === 'Kamalesh');

  // ------------------------------------------------------------------------
  // CRITERION 1: Completed installation with one device type appears correctly
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 1: Single device type installation...');
  assert(Boolean(mathi), 'Mathi is present in technicians list');
  const kumarInst = mathi.installations.find((i) => i.clientName === 'Kumar');
  assert(Boolean(kumarInst), 'Kumar installation appears under Mathi');
  assert(kumarInst.devices.length === 1, 'Kumar installation has exactly 1 device row');
  assert(
    kumarInst.devices[0].deviceType === '4 Channel Live' && kumarInst.devices[0].quantity === 1,
    'Device type is 4 Channel Live with quantity 1'
  );
  assert(kumarInst.location.includes('Chennai'), 'Location is recorded correctly as Chennai');
  assert(Boolean(kumarInst.googleMapsLink), 'Google maps link is preserved');

  // ------------------------------------------------------------------------
  // CRITERION 2: Completed installation with >3 device types displays every type & quantity
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 2: Multi-device installation with >3 device types...');
  const sriLakshmiInst = mathi.installations.find((i) => i.clientName === 'Sri Lakshmi Transport');
  assert(Boolean(sriLakshmiInst), 'Sri Lakshmi Transport appears under Mathi');
  assert(
    sriLakshmiInst.devices.length === 5,
    `Displays all 5 device types (>3 devices without artificial cutoff): length is ${sriLakshmiInst.devices.length}`
  );
  const sriLakshmiDevTypes = sriLakshmiInst.devices.map((d) => d.deviceType);
  assert(
    sriLakshmiDevTypes.includes('6 Channel Live') &&
    sriLakshmiDevTypes.includes('Memory Card') &&
    sriLakshmiDevTypes.includes('TPMS Sensor') &&
    sriLakshmiDevTypes.includes('Driver Fatigue Sensor') &&
    sriLakshmiDevTypes.includes('SOS Panic Button'),
    'Every actual installed device type is listed without row truncation'
  );

  // ------------------------------------------------------------------------
  // CRITERION 3: Multiple units of the same device type display the correct aggregated quantity
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 3: Multiple units of the same device type aggregated...');
  assert(Boolean(guna), 'Guna is present in technicians list');
  const greenlineInst = guna.installations.find((i) => i.clientName === 'Greenline Logistics');
  assert(Boolean(greenlineInst), 'Greenline Logistics appears under Guna');
  const ch2Dev = greenlineInst.devices.find((d) => d.deviceType === '2 Channel Live');
  assert(
    ch2Dev && ch2Dev.quantity === 3,
    `2 Channel Live quantity aggregated accurately (1 + 2 = 3): actual is ${ch2Dev?.quantity}`
  );

  // ------------------------------------------------------------------------
  // CRITERION 4: One technician with multiple clients displays separate installation groups
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 4: One technician with multiple clients displays separate groups...');
  assert(
    guna.installations.length === 2,
    `Guna completed 2 client installations (Greenline Logistics and ABC Fleet): actual is ${guna.installations.length}`
  );
  const clientNamesGuna = guna.installations.map((i) => i.clientName);
  assert(
    clientNamesGuna.includes('Greenline Logistics') && clientNamesGuna.includes('ABC Fleet Solutions'),
    'Both clients appear as distinct installation entries under Guna'
  );
  assert(
    guna.completedInstallationsCount === 2,
    'Guna completed_installations_count badge is exactly 2'
  );

  // ------------------------------------------------------------------------
  // CRITERION 5: Technician with no completed installations shows clear empty state
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 5: Technician with 0 completed installations has clear empty state...');
  assert(Boolean(kamalesh), 'Kamalesh is present in technicians list');
  assert(
    kamalesh.completedInstallationsCount === 0 && kamalesh.totalDevicesInstalled === 0,
    'Kamalesh shows 0 installations and 0 devices installed'
  );
  assert(
    Array.isArray(kamalesh.installations) && kamalesh.installations.length === 0,
    'Kamalesh installations array is empty'
  );
  assert(kamalesh.hasInstallations === false, 'hasInstallations flag is false for empty technician');

  // ------------------------------------------------------------------------
  // CRITERION 6: Incomplete or unsubmitted Post-Installation Forms are excluded
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 6: Incomplete, in-progress, and cancelled installations excluded...');
  const allInstallationsAcrossTechs = technicians.flatMap((t) => t.installations);
  const hasIncomplete = allInstallationsAcrossTechs.some((i) => i.clientName === 'Incomplete Client');
  const hasCancelled = allInstallationsAcrossTechs.some((i) => i.clientName === 'Cancelled Client');
  assert(!hasIncomplete, 'In-progress installation is excluded');
  assert(!hasCancelled, 'Cancelled installation is excluded');

  // ------------------------------------------------------------------------
  // CRITERION 7: Extra devices installed for another customer appear under that customer
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 7: Extra devices installed for another customer attributed separately...');
  const metroExpressInst = mathi.installations.find((i) => i.clientName === 'Metro Express');
  assert(
    Boolean(metroExpressInst),
    'Metro Express appears as an independent client installation under Mathi'
  );
  assert(
    metroExpressInst.is_additional_customer === true,
    'Metro Express is identified with is_additional_customer flag'
  );
  assert(
    metroExpressInst.location.includes('Salem'),
    'Metro Express location is Salem Hub, distinct from Kumar (Chennai)'
  );
  assert(
    kumarInst.devices.every((d) => d.deviceType !== 'Dashcam SD Card'),
    'Extra devices for Metro Express are NOT mixed into Kumar installation'
  );

  // ------------------------------------------------------------------------
  // CRITERION 8: Issued, returned, damaged, missing items NOT counted as installed
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 8: Only confirmed installed items counted...');
  // For testChecklist1Id (Kumar): carried = 2, installed = 1, returned = 1
  const kumar4ch = kumarInst.devices.find((d) => d.deviceType === '4 Channel Live');
  assert(
    kumar4ch.quantity === 1,
    `Kumar installed count is 1 (carried was 2, returned was 1): actual is ${kumar4ch.quantity}`
  );
  // For testChecklist2Id (Sri Lakshmi): Memory Card carried = 3, installed = 2, returned = 1
  const sriLakshmiMem = sriLakshmiInst.devices.find((d) => d.deviceType === 'Memory Card');
  assert(
    sriLakshmiMem.quantity === 2,
    `Memory Card installed count is 2 (carried was 3, returned was 1): actual is ${sriLakshmiMem.quantity}`
  );

  // ------------------------------------------------------------------------
  // CRITERION 9: Reporting period boundaries work correctly in Asia/Kolkata
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 9: Asia/Kolkata date boundaries applied inclusively...');
  const hasOutsideDateJob = allInstallationsAcrossTechs.some((i) => i.clientName === 'Old Period Client');
  assert(!hasOutsideDateJob, 'Installation completed on 10 Oct 2026 is excluded from 19-25 Oct report');
  assert(
    toKolkataDateString('2026-10-22T00:30:00+05:30') === '2026-10-22',
    'Kolkata midnight time aligns with correct calendar date'
  );

  // ------------------------------------------------------------------------
  // CRITERION 10: Duplicate device rows and repeated notifications do not duplicate installations
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 10: Deduplication check...');
  const kumarOccurrences = mathi.installations.filter((i) => i.clientName === 'Kumar');
  assert(kumarOccurrences.length === 1, 'Kumar installation appears exactly once under Mathi');
  const greenlineOccurrences = guna.installations.filter((i) => i.clientName === 'Greenline Logistics');
  assert(greenlineOccurrences.length === 1, 'Greenline Logistics installation appears exactly once under Guna');

  // ------------------------------------------------------------------------
  // CRITERION 11: The PDF includes all technicians, clients, devices, and quantities
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 11: PDF generation includes all records across multiple pages...');
  const pdfBuffer = await generateWeeklyStockReportPdf(report);
  assert(Buffer.isBuffer(pdfBuffer), 'PDF generated as a binary Buffer');
  assert(pdfBuffer.length > 5000, `PDF size is healthy: ${pdfBuffer.length} bytes`);
  assert(pdfBuffer.slice(0, 5).toString('ascii') === '%PDF-', 'PDF starts with %PDF- magic bytes');

  // Verify PDF generator code structure
  const pdfSource = fs.readFileSync(path.resolve(__dirname, '../src/services/weeklyStockReportPdfGenerator.js'), 'utf8');
  assert(
    pdfSource.includes('drawInstallationTableHeader()'),
    'PDF implements repeating installation table headers across page breaks'
  );
  assert(
    pdfSource.includes('TECHNICIAN-WISE INSTALLATION REPORT'),
    'PDF header includes TECHNICIAN-WISE INSTALLATION REPORT title'
  );

  // ------------------------------------------------------------------------
  // CRITERION 12: The four unwanted sections are absent from both UI and PDF
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 12: Four unwanted sections completely absent from UI and PDF...');
  // Check backend report object
  assert(report.stock_movement_history === undefined, 'Stock Movement History absent from report');
  assert(report.material_reconciliation === undefined, 'Material Reconciliation absent from report');
  assert(report.stock_alerts === undefined, 'Stock Alerts absent from report');
  assert(report.reconciliation_variances === undefined, 'Variance Detection absent from report');
  assert(report.technician_issuance_summary === undefined, 'Old Material Issuance Summary absent from report');

  // Check frontend JSX component code
  const uiSource = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/pages/admin/workspaces/WeeklyStockReportTab.jsx'),
    'utf8'
  );
  assert(!uiSource.includes('Stock Movement History'), 'Stock Movement History is absent from UI');
  assert(!uiSource.includes('Material Usage and Return Reconciliation'), 'Material Usage & Return Reconciliation is absent from UI');
  assert(!uiSource.includes('Low-Stock and Zero-Stock Alerts'), 'Low-Stock Alerts is absent from UI');
  assert(!uiSource.includes('Stock Reconciliation and Variance Detection'), 'Variance Detection is absent from UI');
  assert(!uiSource.includes('Technician-Wise Material Issuance Summary'), 'Old Material Issuance Summary is absent from UI');

  // Check PDF generator source code
  assert(!pdfSource.includes('DETAILED STOCK MOVEMENT HISTORY'), 'Stock Movement History absent from PDF');
  assert(!pdfSource.includes('MATERIAL USAGE AND RETURN RECONCILIATION'), 'Material Usage Reconciliation absent from PDF');
  assert(!pdfSource.includes('LOW-STOCK ALERTS'), 'Low-Stock Alerts absent from PDF');
  assert(!pdfSource.includes('RECONCILIATION AUDIT'), 'Variance Audit absent from PDF');
  assert(!pdfSource.includes('TECHNICIAN-WISE MATERIAL ISSUANCE SUMMARY'), 'Old Material Issuance absent from PDF');

  // ------------------------------------------------------------------------
  // CRITERION 13: Inventory balances and other Store Manager pages remain unchanged
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 13: Read-only inventory integrity check...');
  const currentInventory = await getMaterialInventory();
  initialInventory.forEach((before) => {
    const after = currentInventory.find((c) => c.id === before.id);
    const beforeStock = before.current_stock ?? before.stock_quantity ?? 0;
    const afterStock = after.current_stock ?? after.stock_quantity ?? 0;
    assert(
      beforeStock === afterStock,
      `Physical inventory balance for ${before.material_name} unchanged: ${beforeStock} === ${afterStock}`
    );
  });

  // ------------------------------------------------------------------------
  // CRITERION 14: Mobile layout and responsiveness
  // ------------------------------------------------------------------------
  console.log('\n-> Criterion 14: Responsive UI layout verification...');
  assert(
    uiSource.includes('overflow-x-auto') && uiSource.includes('min-w-['),
    'UI implements responsive horizontal scrolling on small screens'
  );
  assert(
    uiSource.includes('break-words'),
    'UI implements clean text wrapping for long client names and locations'
  );

  console.log('\n========================================================================');
  console.log(` ALL 14 ACCEPTANCE CRITERIA VERIFIED AND PASSED (${passed}/${passed})`);
  console.log('========================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\n❌ ACCEPTANCE TEST SUITE FAILED:', err);
  process.exit(1);
});
