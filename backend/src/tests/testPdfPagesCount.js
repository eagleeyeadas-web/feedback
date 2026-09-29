import { generateQuotationPDF } from '../services/quotationPdfGenerator.js';
import { jsPDF } from 'jspdf';

async function testPdfPageCount() {
  console.log('--- Testing PDF Page Count & Layout ---');

  const testQuotation = {
    quotation_number: 'CQS/00231',
    quotation_date: '2026-09-23',
    customer_name: 'ABM TRANSPORT',
    contact_person: 'IYYAPPAN',
    address: 'THANJAVUR\n9384329903',
    phone_number: '9384329903',
    gst_number: '',
    subtotal: 18644,
    gst_applicable: true,
    gst_type: 'CGST_SGST',
    cgst_pct: 9,
    cgst_amount: 1678,
    sgst_pct: 9,
    sgst_amount: 1678,
    net_amount: 22000,
    include_tech_specs: true,
  };

  const testItems = [
    {
      sno: 1,
      item_description: '2 channel LIVE 10 inch AI processing display with (2 cameras & 2 cables)',
      hsn_sac: '852589',
      qty: 1,
      uom: 'SET',
      rate: 18644,
      discount_pct: 0,
      discount_amount: 0,
      amount: 18644,
    }
  ];

  const pdfBuffer = await generateQuotationPDF(testQuotation, testItems);
  
  // Parse PDF Buffer using jsPDF or check arraybuffer size
  console.log(`Generated PDF Buffer Byte Size: ${pdfBuffer.length} bytes`);

  // Simple page count validation: search for "/Type /Page" or "/Count 2" in PDF structure
  const pdfStr = pdfBuffer.toString('binary');
  const pageMatches = pdfStr.match(/\/Type\s*\/Page\b/g);
  const totalPages = pageMatches ? pageMatches.length : 0;

  console.log(`Total Pages Count in Generated PDF: ${totalPages}`);

  if (totalPages === 2) {
    console.log('✅ VERIFICATION PASSED: Generated PDF contains EXACTLY 2 PAGES.');
  } else {
    console.error(`❌ VERIFICATION FAILED: Expected 2 pages, got ${totalPages}`);
  }
}

testPdfPageCount().catch(console.error);
