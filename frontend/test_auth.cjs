const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://xwdrdkykgahilpqobwis.supabase.co';
const validKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3ZHJka3lrZ2FoaWxwcW9id2lzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDU2OTA2MiwiZXhwIjoyMTA6MTQ1MDYyfQ._iE9XBScZ0iy5JuAGA970xJwW3DtFw8nXbI4IMhtPNM';
const correctKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3ZHJka3lrZ2FoaWxwcW9id2lzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDU2OTA2MiwiZXhwIjoyMTA6MTQ1MDYyfQ._iE9XBScZ0iy5JuAGA970xJwW3DtFw8nXbI4IMhtPNM';

async function run() {
  console.log("--- Testing Corrupted Key (with 210:145062) ---");
  try {
    const clientBad = createClient(supabaseUrl, validKey);
    const resBad = await clientBad.auth.signInWithPassword({ email: 'eagleeye@gmail.com', password: '123456' });
    console.log("Bad key result:", resBad.error ? resBad.error.message : "Success");
  } catch(e) {
    console.log("Bad key threw exception:", e.message);
  }

  console.log("\n--- Testing Corrected Key (with 2106145062) ---");
  try {
    const clientGood = createClient(supabaseUrl, correctKey);
    const resGood = await clientGood.auth.signInWithPassword({ email: 'eagleeye@gmail.com', password: '123456' });
    if (resGood.error) {
      console.log("Good key auth error:", resGood.error.message);
    } else {
      console.log("Good key auth SUCCESS! User:", resGood.data.user.email);
    }
  } catch(e) {
    console.log("Good key threw exception:", e.message);
  }
}

run();
