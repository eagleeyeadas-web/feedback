import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import {
  getResetPreview,
  executeCompleteOperationalReset,
} from '../services/operationalResetService.js';

async function main() {
  const args = process.argv.slice(2);
  const isPreview = args.includes('--preview') || args.length === 0;
  const isExecute = args.includes('--execute');
  const isConfirmed = args.includes('--confirm');

  // Parse optional custom opening balances
  let customBalances = {};
  const balancesArg = args.find((a) => a.startsWith('--balances='));
  if (balancesArg) {
    try {
      customBalances = JSON.parse(balancesArg.slice('--balances='.length));
    } catch (e) {
      console.error('Invalid JSON in --balances argument:', e.message);
      process.exit(1);
    }
  }

  console.log('========================================================================');
  console.log('   EAGLE EYE SAFDRIVE — OPERATIONAL DATA RESET & QUOTATION SAFEGUARD   ');
  console.log('========================================================================\n');

  if (isPreview && !isExecute) {
    console.log('Mode: PREVIEW ONLY (No database records will be modified)\n');
    console.log('Fetching live operational counts and auditing quotation records...\n');

    const preview = await getResetPreview();

    console.log('------------------------------------------------------------------------');
    console.log(' 1. PROTECTED QUOTATION DATA (WILL NOT BE MODIFIED OR DELETED)');
    console.log('------------------------------------------------------------------------');
    console.log(` Status:                  ${preview.protected_quotations.status}`);
    console.log(` Existing Quotations:     ${preview.protected_quotations.total_quotations}`);
    console.log(` Quotation Line Items:    ${preview.protected_quotations.total_line_items}`);
    console.log(` Highest Sequence:        ${preview.protected_quotations.highest_sequence_number}`);
    console.log(` Next Quotation Number:   ${preview.protected_quotations.next_quotation_number}`);
    console.log(` Quotation Numbers:       ${preview.protected_quotations.quotation_numbers.join(', ')}`);

    console.log('\n------------------------------------------------------------------------');
    console.log(' 2. PROTECTED MASTER DATA & CONFIGURATION (WILL NOT BE DELETED)');
    console.log('------------------------------------------------------------------------');
    console.log(` Device Products:         ${preview.protected_master_data.device_products_catalogue}`);
    console.log(` Installation Materials:  ${preview.protected_master_data.materials_catalogue}`);
    console.log(` Device BOM Templates:    ${preview.protected_master_data.device_bom_templates}`);
    console.log(` BOM Item Definitions:    ${preview.protected_master_data.bom_material_items}`);
    console.log(` Service Engineers:       ${preview.protected_master_data.service_engineers}`);

    console.log('\n------------------------------------------------------------------------');
    console.log(' 3. OPERATIONAL RECORDS TO BE RESET & CLEARED');
    console.log('------------------------------------------------------------------------');
    let totalOpRecords = 0;
    for (const [table, count] of Object.entries(preview.operational_records_to_reset)) {
      console.log(` - ${table.padEnd(38)} : ${count} record(s)`);
      totalOpRecords += count;
    }
    console.log(` Total Operational Records to Clear: ${totalOpRecords}`);

    console.log('\n------------------------------------------------------------------------');
    console.log(' 4. CONFIGURABLE INVENTORY OPENING BALANCES (BASELINE: 0)');
    console.log('------------------------------------------------------------------------');
    console.log(' Device Products:');
    preview.configurable_opening_balances.devices.forEach((d) => {
      console.log(`   * ${d.sku.padEnd(16)} (${d.device_type.padEnd(22)}) -> Opening: 0 Nos.`);
    });
    console.log(' Installation Materials:');
    preview.configurable_opening_balances.materials.forEach((m) => {
      console.log(`   * ${(m.sku || 'N/A').padEnd(16)} (${m.material_name.padEnd(32)}) -> Opening: 0 ${m.unit}`);
    });

    console.log('\n========================================================================');
    console.log(' To execute this reset with 100% quotation protection, run:');
    console.log('   node src/scripts/executeOperationalReset.js --execute --confirm');
    console.log(' Optional custom opening balances:');
    console.log('   node src/scripts/executeOperationalReset.js --execute --confirm --balances=\'{"EE-2CH-LIVE": 10}\'');
    console.log('========================================================================\n');
    return;
  }

  if (isExecute) {
    if (!isConfirmed) {
      console.error('ERROR: Explicit confirmation required! Add --confirm to execute.');
      console.error('Command: node src/scripts/executeOperationalReset.js --execute --confirm');
      process.exit(1);
    }

    console.log('Starting Complete Operational Reset...\n');
    const result = await executeCompleteOperationalReset({
      openingBalances: customBalances,
      executedBy: 'ADMIN_CLI_SCRIPT',
      confirmReset: true,
    });

    console.log('\n========================================================================');
    console.log('             OPERATIONAL RESET COMPLETED SUCCESSFULLY!                  ');
    console.log('========================================================================\n');
    console.log(`Timestamp:        ${result.reset_timestamp}`);
    console.log(`Execution Time:   ${result.execution_duration_ms} ms`);
    console.log('\nQuotation Protection Status:');
    console.log(` - Status:        ${result.quotation_protection.status}`);
    console.log(` - Quotations:    ${result.quotation_protection.quotations_preserved} (100% Intact)`);
    console.log(` - Items:         ${result.quotation_protection.quotation_items_preserved} (100% Intact)`);
    console.log(` - Numbers:       ${result.quotation_protection.numbers_preserved.join(', ')}`);

    console.log('\nOperational Records Cleared:');
    for (const [table, count] of Object.entries(result.operational_records_cleared)) {
      if (count > 0) {
        console.log(` - ${table.padEnd(38)} : ${count} deleted`);
      }
    }
    console.log(` - Remaining Checklists : ${result.operational_checklists_remaining}`);

    console.log('\nInventory Initialized:');
    console.log(` - Status:        ${result.inventory_reset.status}`);
    console.log(` - Reason:        ${result.inventory_reset.reason}`);
    console.log(` - Devices Reset: ${result.inventory_reset.opening_balances_applied.devices.length}`);
    console.log(` - Materials Reset: ${result.inventory_reset.opening_balances_applied.materials.length}`);
    console.log(` - Ledger Movements Created: ${result.inventory_reset.opening_ledger_movements_created}`);

    console.log('\n========================================================================\n');
  }
}

main().catch((err) => {
  console.error('\n❌ RESET EXECUTION ERROR:', err);
  process.exit(1);
});
