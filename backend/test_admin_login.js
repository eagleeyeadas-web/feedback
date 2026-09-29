import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;

// Use public anon key for sign in simulation like frontend
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3ZHJka3lrZ2FoaWxwcW9id2lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NjkwNjIsImV4cCI6MjEwNjE0NTA2Mn0.anonKeyPlaceholder';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceKey);

async function testLogin() {
  console.log('Testing Admin Sign In for eagleeye@gmail.com with pass: 123456 ...');

  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'eagleeye@gmail.com',
    password: '123456',
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
