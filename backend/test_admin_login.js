import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;

// Use anon key from environment for sign in simulation like frontend
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceKey);

async function testLogin() {
  const adminPassword = process.env.TEST_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('TEST_ADMIN_PASSWORD or ADMIN_PASSWORD environment variable is required to run this test.');
    process.exit(1);
  }

  console.log('Testing Admin Sign In for eagleeye@gmail.com ...');

  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'eagleeye@gmail.com',
    password: adminPassword,
  });

  if (error) {
    console.error('Sign In ERROR:', error.message);
  } else {
    console.log('Sign In SUCCESS!');
    console.log('User Email:', data.user.email);
    console.log('User Role:', data.user.role);
    console.log('Access Token Length:', data.session.access_token.length);
  }
}

testLogin();
