import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from '../src/services/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKUP_DIR = path.resolve(__dirname, '../backup/pre_permanent_deletion_20261022');

async function runBackup() {
  console.log(`Starting backup to ${BACKUP_DIR}...`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const tables = ['quotations', 'quotation_items', 'system_cleanup_state', 'admin_users'];

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*');
    if (error) {
      console.error(`Failed to backup ${table}:`, error.message);
      process.exit(1);
    }
    const dest = path.join(BACKUP_DIR, `${table}.json`);
    fs.writeFileSync(dest, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`✓ Backed up ${table}: ${data.length} records`);
  }

  // Backup sequence files
  const rootSeq = path.resolve(__dirname, '../../assets/quotation_sequence.json');
  const backendSeq = path.resolve(__dirname, '../assets/quotation_sequence.json');
  if (fs.existsSync(rootSeq)) {
    fs.copyFileSync(rootSeq, path.join(BACKUP_DIR, 'root_quotation_sequence.json'));
    console.log('✓ Backed up root quotation_sequence.json');
  }
  if (fs.existsSync(backendSeq)) {
    fs.copyFileSync(backendSeq, path.join(BACKUP_DIR, 'backend_quotation_sequence.json'));
    console.log('✓ Backed up backend quotation_sequence.json');
  }

  const manifest = {
    timestamp: new Date().toISOString(),
    description: 'Pre-permanent deletion snapshot for 20-day automatic quotation deletion policy',
  };
  fs.writeFileSync(path.join(BACKUP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Backup completed successfully.');
  process.exit(0);
}

runBackup().catch(err => {
  console.error('Backup error:', err);
  process.exit(1);
});
