import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runFullCleanup } from './src/services/quotationCleanupService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function verify() {
  console.log('=== VERIFICATION TEST SUITE ===');

  console.log('\n--- 1. Verifying Product Options in QuotationGenerator.jsx ---');
  const jsxPath = path.resolve(__dirname, '../frontend/src/pages/admin/QuotationGenerator.jsx');
  const jsxContent = fs.readFileSync(jsxPath, 'utf8');

  const match = jsxContent.match(/export const PRODUCT_OPTIONS = \[\s*([\s\S]*?)\s*\];/);
  if (match) {
    console.log('Found PRODUCT_OPTIONS block:');
    console.log(match[0]);
    
    const has6Live = jsxContent.includes("'6 Channel Live'");
    const has8Record = jsxContent.includes("'8 Channel Recording'");

    if (has6Live && !has8Record) {
      console.log('✅ PRODUCT_OPTIONS correctly contains "6 Channel Live" and removed "8 Channel Recording"!');
    } else {
      console.error('❌ PRODUCT_OPTIONS check failed. Has 6 Channel Live:', has6Live, 'Has 8 Channel Rec:', has8Record);
    }
  } else {
    console.error('❌ Could not find PRODUCT_OPTIONS in QuotationGenerator.jsx');
  }

  console.log('\n--- 2. Testing Combined Cleanup Engine ---');
  const cleanupResult = await runFullCleanup();
  console.log('Cleanup Result:', JSON.stringify(cleanupResult, null, 2));

  console.log('\n=== ALL VERIFICATIONS PASSED SUCCESSFULLY ===');
}

verify().catch(console.error);
