import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import supabase from '../src/services/supabase.js';

async function updateCoordinatorPassword() {
  const newPassword = 'booking@2026';
  const email = 'coordinator@gmail.com';

  console.log(`Locating user account for ${email}...`);
  const { data: authList, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    throw new Error(`Failed to list users: ${listError.message}`);
  }

  const user = (authList?.users || []).find(
    (u) => (u.email || '').toLowerCase() === email
  );

  if (!user) {
    throw new Error(`User ${email} not found in Supabase Auth.`);
  }

  console.log(`Found user ID: ${user.id}. Updating password to: ${newPassword}`);
  const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(
    user.id,
    {
      password: newPassword,
      email_confirm: true,
      app_metadata: { role: 'COORDINATOR' },
      user_metadata: {
        ...user.user_metadata,
        role: 'COORDINATOR',
      },
    }
  );

  if (updateError) {
    throw new Error(`Failed to update password: ${updateError.message}`);
  }

  console.log(`Successfully updated password for ${email}!`);

  // Verify by signing in
  console.log(`Verifying authentication with new password...`);
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: newPassword,
  });

  if (signInError) {
    throw new Error(`Sign in verification failed: ${signInError.message}`);
  }

  console.log(`Sign-in verification successful! User session established (Access token granted).`);
}

updateCoordinatorPassword().catch((err) => {
  console.error('Error updating coordinator password:', err);
  process.exit(1);
});
