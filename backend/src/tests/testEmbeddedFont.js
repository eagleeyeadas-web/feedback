import { jsPDF } from 'jspdf';
import fs from 'fs';
import https from 'https';

// Download a lightweight Google Font TTF (Roboto or Noto Sans) that contains the Rupee symbol (U+20B9)
const fontUrl = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans-Bold.ttf';

https.get(fontUrl, (res) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    const fontBuffer = Buffer.concat(chunks);
    const fontBase64 = fontBuffer.toString('base64');

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    
    // Register font in jsPDF Virtual File System
    doc.addFileToVFS('NotoSans-Bold.ttf', fontBase64);
    doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
    doc.setFont('NotoSans', 'bold');
    doc.setFontSize(10);

    doc.text('Rate (₹)', 20, 20);
    doc.text('Amount (₹)', 20, 30);
    doc.text('18,644 ₹', 20, 40);

    const outBuf = Buffer.from(doc.output('arraybuffer'));
    fs.writeFileSync('test_notosans_rupee.pdf', outBuf);
    console.log('Saved test_notosans_rupee.pdf, byte size:', outBuf.length);
  });
}).on('error', (err) => console.error('Error downloading font:', err));
