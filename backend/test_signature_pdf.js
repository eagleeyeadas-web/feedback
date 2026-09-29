import fs from 'fs';
import { generateQuotationPDF } from './src/services/quotationPdfGenerator.js';

async function testSignaturePdf() {
  const mockQuotation = {
    quotation_number: 'CQS/00240',
    customer_name: 'Test Customer Pvt Ltd',
    customer_address: '123 Test Street, Coimbatore',
    quotation_date: '2026-09-29',
    valid_until: '2026-10-29',
    net_amount: 25000,
    cgst_amount: 2250,
    sgst_amount: 2250,
    gst_applicable: true,
    gst_type: 'CGST_SGST',
    display_size: '7-inch',
  };

  const items = [
    {
      sno: 1,
      item_description: '2 Channel Live',
      qty: 1,
      uom: 'Nos',
      rate: 20500,
      amount: 20500,
    },
  ];

  const pdfBuffer = await generateQuotationPDF(mockQuotation, items);
  fs.writeFileSync('sample_signature_test.pdf', pdfBuffer);

  const pdfStr = pdfBuffer.toString('binary');
  const hasCompany = pdfStr.includes('For Eagle Eye Safdrive Pvt Ltd');
  const hasNewSigText = pdfStr.includes('This is a system-generated document. Manual signature is not required.');
  const hasOldSigText = pdfStr.includes('Authorised Signatory');

  console.log('--- SIGNATURE TEST RESULTS ---');
  console.log('Has "For Eagle Eye Safdrive Pvt Ltd":', hasCompany);
  console.log('Has "This is a system-generated document. Manual signature is not required.":', hasNewSigText);
  console.log('Has old "Authorised Signatory":', hasOldSigText);

  if (hasCompany && hasNewSigText && !hasOldSigText) {
    console.log('SUCCESS: Signature section successfully updated!');
  } else {
    console.error('FAILURE: Signature section verification failed.');
  }
}

testSignaturePdf().catch(console.error);
