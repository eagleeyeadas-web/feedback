import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testFullSubmission() {
  console.log('--- Step 1: Generate ID ---');
  const { data: idResult, error: idError } = await supabase.rpc('generate_feedback_id');
  if (idError) {
    console.error('RPC Error:', idError);
    return;
  }
  console.log('Generated Feedback ID:', idResult);

  const feedbackId = idResult;
  const signaturePath = `signatures/${feedbackId}.png`;

  console.log('--- Step 2: Upload Dummy Signature ---');
  const dummySignatureBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const { error: sigError } = await supabase.storage.from('signatures').upload(signaturePath, dummySignatureBuffer, {
    contentType: 'image/png',
    upsert: true,
  });

  if (sigError) {
    console.error('Signature Upload Error:', sigError);
    return;
  }
  console.log('Signature Uploaded:', signaturePath);

  console.log('--- Step 3: Insert Feedback Record ---');
  const record = {
    feedback_id: feedbackId,
    customer_name: 'Test Customer',
    phone_number: '9876543210',
    company_name: 'Test Logistics',
    email: 'test@example.com',
    vehicle_number: 'TN 37 AB 1234',
    imei_number: '123456789012345',
    vehicle_type: 'Truck 16 Wheeler',
    product_service: 'GPS Tracker Pro',
    service_date: '2026-09-28',
    technician: 'Suresh',
    rating_product_quality: 5,
    rating_installation: 5,
    rating_performance: 4,
    rating_professionalism: 5,
    rating_support: 5,
    issue_resolved: 'Yes',
    improvement_suggestions: 'Great service',
    additional_comments: 'No additional comments',
    signature_path: signaturePath,
    submitted_at: new Date().toISOString(),
  };

  const { data: insertedData, error: insertError } = await supabase
    .from('feedback')
    .insert(record)
    .select()
    .single();

  if (insertError) {
    console.error('Insert Error:', insertError);
    return;
  }
  console.log('Insert SUCCESS! Inserted Record ID:', insertedData.id);
}

testFullSubmission();
