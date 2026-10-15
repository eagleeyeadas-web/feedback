import dotenv from 'dotenv';
dotenv.config();

import supabase from '../src/services/supabase.js';

async function inspectMasterTables() {
  const masterTables = [
    'admin_users',
    'service_engineers',
    'inventory_products',
    'device_boms',
    'material_inventory',
    'installation_checklist_sequence',
    'system_cleanup_state'
  ];

  for (const t of masterTables) {
    const { data } = await supabase.from(t).select('*');
    console.log(`\n=== TABLE: ${t} (${data?.length || 0} rows) ===`);
    console.log(JSON.stringify(data, null, 2));
  }
}

inspectMasterTables().catch(console.error);
