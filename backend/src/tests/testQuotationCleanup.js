import supabase from '../services/supabase.js';
import { runQuotationCleanup } from '../services/quotationCleanupService.js';
import { generateQuotationPDF } from '../services/quotationPdfGenerator.js';

async function testCleanupWorkflow() {
  console.log('--- Starting Test: Quotation 10-Day Auto Cleanup ---');

  const testQuotationNo = `CQS/TEST-${Date.now()}`;
  const now = new Date();
  const pastExpiry = new Date(now.getTime() - (60 * 60 * 1000)); // 1 hour ago

  // 1. Generate test PDF buffer
  const sampleQuotation = {
    quotation_number: testQuotationNo,
    customer_name: 'TEST CLEANUP CLIENT',
    contact_person: 'Tester',
    address: 'Test Address',
    phone_number: '9999999999',
    quotation_date: now.toISOString().split('T')[0],
    subtotal: 1000,
    net_amount: 1180,
    gst_applicable: true,
    gst_type: 'CGST_SGST',
    cgst_pct: 9,
    cgst_amount: 90,
    sgst_pct: 9,
    sgst_amount: 90,
  };

  const sampleItems = [
    { item_description: 'Test Item for Cleanup', qty: 1, uom: 'Nos', rate: 1000, discount_pct: 0, discount_amount: 0, amount: 1000 }
  ];

  const pdfBuffer = await generateQuotationPDF(sampleQuotation, sampleItems);
  const pdfPath = `quotations/test_cleanup_${Date.now()}.pdf`;

  // 2. Upload test PDF to Supabase Storage
  console.log(`1. Uploading test PDF to Supabase Storage: ${pdfPath}`);
  const { error: uploadErr } = await supabase.storage.from('pdfs').upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
  if (uploadErr) {
    console.error('Failed to upload test PDF:', uploadErr.message);
    return;
  }

  // 3. Insert test quotation record with expired timestamp
  console.log(`2. Inserting test quotation record into DB (expires_at: ${pastExpiry.toISOString()})`);
  const { data: inserted, error: insertErr } = await supabase.from('quotations').insert([{
    quotation_number: testQuotationNo,
    customer_name: sampleQuotation.customer_name,
    quotation_date: sampleQuotation.quotation_date,
    subtotal: 1000,
    net_amount: 1180,
    pdf_path: pdfPath,
    created_at: now.toISOString(),
    expires_at: pastExpiry.toISOString(),
  }]).select().single();

  if (insertErr) {
    console.error('Failed to insert test quotation:', insertErr.message);
    return;
  }

  console.log(`3. Successfully created test quotation ID: ${inserted.id}`);

  // 4. Run cleanup job
  console.log('4. Running cleanup job...');
  const result = await runQuotationCleanup();
  console.log('Cleanup Result:', result);

  // 5. Verify database record is deleted
  const { data: checkDb } = await supabase.from('quotations').select('id').eq('id', inserted.id).maybeSingle();
  if (!checkDb) {
    console.log('✅ VERIFICATION PASSED: Database record was successfully deleted.');
  } else {
    console.error('❌ VERIFICATION FAILED: Database record still exists!');
  }

  // 6. Verify PDF is deleted from storage
  const { data: checkStorage } = await supabase.storage.from('pdfs').list('quotations', { search: pdfPath.replace('quotations/', '') });
  if (!checkStorage || checkStorage.length === 0) {
    console.log('✅ VERIFICATION PASSED: Storage PDF file was successfully deleted.');
  } else {
    console.log('ℹ️ Storage file check response:', checkStorage);
  }

  console.log('--- Test Finished ---');
}

testCleanupWorkflow().catch(console.error);
