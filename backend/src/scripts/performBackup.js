import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from '../services/supabase.js';
import { generateQuotationPDF } from '../services/quotationPdfGenerator.js';
import { peekNextQuotationNumber } from '../services/quotationSequenceService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKUP_DIR = path.resolve(__dirname, '../../backup/pre_cleanup_snapshot_20261021');
const DATA_DIR = path.resolve(__dirname, '../data');
const ASSETS_DIR = path.resolve(__dirname, '../../assets');

async function runBackup() {
  console.log('=== STAGE 2: BACKUP AND VERIFICATION ===');
  console.log(`Backup Destination: ${BACKUP_DIR}`);

  // 1. Create backup directories
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupDataDir = path.join(BACKUP_DIR, 'data');
  fs.mkdirSync(backupDataDir, { recursive: true });

  // 2. Backup Local Data Storage Files
  console.log('\n--- 1. Backing up Local JSON Data Files ---');
  const localFiles = fs.readdirSync(DATA_DIR);
  let localFileBackupCount = 0;
  for (const file of localFiles) {
    if (file.endsWith('.json')) {
      const src = path.join(DATA_DIR, file);
      const dest = path.join(backupDataDir, file);
      fs.copyFileSync(src, dest);
      const stats = fs.statSync(dest);
      console.log(`  ✓ Backed up ${file} (${stats.size} bytes)`);
      localFileBackupCount++;
    }
  }

  // Backup quotation sequence file
  const seqSrc = path.join(ASSETS_DIR, 'quotation_sequence.json');
  if (fs.existsSync(seqSrc)) {
    const seqDest = path.join(BACKUP_DIR, 'quotation_sequence.json');
    fs.copyFileSync(seqSrc, seqDest);
    console.log(`  ✓ Backed up quotation_sequence.json`);
  }

  // 3. Backup Supabase Tables
  console.log('\n--- 2. Backing up Supabase Database Tables ---');
  const tables = [
    'quotations',
    'quotation_items',
    'installation_checklists',
    'store_material_requirements',
    'technical_installation_reports',
    'job_device_returns',
    'material_inventory',
    'inventory_products',
    'bom_items',
    'stock_movements',
    'admin_users',
    'service_engineers',
    'push_subscriptions',
  ];

  const dbBackupSummary = {};

  for (const table of tables) {
    const { data, error, count } = await supabase
      .from(table)
      .select('*', { count: 'exact' });

    if (error) {
      console.error(`  ✗ Error backing up ${table}:`, error.message);
      throw error;
    }

    const filePath = path.join(BACKUP_DIR, `${table}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    dbBackupSummary[table] = {
      recordCount: data.length,
      bytes: fs.statSync(filePath).size,
      sha256Sample: data.length > 0 ? (data[0].id || 'ok') : 'empty',
    };
    console.log(`  ✓ Table '${table}': backed up ${data.length} records (${dbBackupSummary[table].bytes} bytes)`);
  }

  // 4. Quotation Baseline Verification
  console.log('\n--- 3. Quotation System Baseline Verification ---');
  const quotationsBackup = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'quotations.json'), 'utf-8'));
  const quotationItemsBackup = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'quotation_items.json'), 'utf-8'));

  console.log(`  Total Quotations Backed Up: ${quotationsBackup.length}`);
  console.log(`  Total Quotation Items Backed Up: ${quotationItemsBackup.length}`);

  if (quotationsBackup.length !== 31) {
    throw new Error(`Quotation count mismatch! Expected 31, got ${quotationsBackup.length}`);
  }
  if (quotationItemsBackup.length !== 37) {
    throw new Error(`Quotation items count mismatch! Expected 37, got ${quotationItemsBackup.length}`);
  }

  // Check next sequence preview
  const nextSeq = await peekNextQuotationNumber();
  console.log(`  Next Quotation Sequence Preview: ${nextSeq}`);

  // Test PDF generation for a sample protected quotation to ensure PDF generation works
  console.log('\n--- 4. Quotation PDF Generation & Retrieval Verification ---');
  const sampleQuotation = quotationsBackup[0];
  const sampleItems = quotationItemsBackup.filter(i => i.quotation_id === sampleQuotation.id);
  console.log(`  Testing PDF generation for quotation: ${sampleQuotation.quotation_number} (${sampleQuotation.customer_name})`);

  const pdfBuffer = await generateQuotationPDF(sampleQuotation, sampleItems);
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error('Quotation PDF generation failed during verification!');
  }
  const testPdfPath = path.join(BACKUP_DIR, 'test_sample_quotation.pdf');
  fs.writeFileSync(testPdfPath, pdfBuffer);
  console.log(`  ✓ PDF successfully generated & verified (${pdfBuffer.length} bytes, written to test_sample_quotation.pdf)`);

  // 5. Store Physical Balances Baseline
  console.log('\n--- 5. Physical Stock Baseline ---');
  const inventoryBackup = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'material_inventory.json'), 'utf-8'));
  console.log(`  Inventory Items Count: ${inventoryBackup.length}`);
  const stockSummary = {};
  for (const item of inventoryBackup) {
    stockSummary[item.material_name] = item.current_stock;
    console.log(`    - ${item.material_name}: ${item.current_stock} ${item.unit}`);
  }

  // 6. Write manifest file
  const manifest = {
    backupTimestamp: new Date().toISOString(),
    backupDirectory: BACKUP_DIR,
    localFilesCount: localFileBackupCount,
    tables: dbBackupSummary,
    quotationBaseline: {
      totalQuotations: quotationsBackup.length,
      totalQuotationItems: quotationItemsBackup.length,
      nextSequencePreview: nextSeq,
      quotationNumbers: quotationsBackup.map(q => q.quotation_number).sort(),
    },
    physicalStockBaseline: stockSummary,
  };

  fs.writeFileSync(path.join(BACKUP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log('\n✓ BACKUP AND BASELINE VERIFICATION COMPLETED SUCCESSFULLY!');
  console.log(`Manifest written to: ${path.join(BACKUP_DIR, 'manifest.json')}`);
}

runBackup().catch(err => {
  console.error('\n✗ BACKUP FAILED:', err);
  process.exit(1);
});
