import dotenv from 'dotenv';
dotenv.config();

import supabase from '../src/services/supabase.js';

async function checkQuotations() {
  const { data: qData, count: qCount } = await supabase
    .from('quotations')
    .select('id, quotation_number, customer_name, quotation_date, net_amount, pdf_path', { count: 'exact' });

  const { data: qiData, count: qiCount } = await supabase
    .from('quotation_items')
    .select('id, quotation_id, item_description, qty, rate, amount', { count: 'exact' });

  console.log(`TOTAL QUOTATIONS: ${qCount}`);
  console.log(`TOTAL QUOTATION ITEMS: ${qiCount}`);
  console.log('Sample Quotations:', qData?.slice(0, 5));
}

checkQuotations().catch(console.error);
