import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import supabase from '../src/services/supabase.js';

export async function ensureHrAccount() {
  console.log('--- Checking HR Account (hr@gmail.com) ---');

  const HR_EMAIL = 'hr@gmail.com';
  const HR_DEFAULT_PASSWORD = process.env.HR_ACCOUNT_PASSWORD || 'hr@2026';

  // 1. List existing auth users
  const { data: authList, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    throw new Error(`Failed to list auth users: ${listError.message}`);
  }

  const existingAuth = (authList?.users || []).find(
    (u) => (u.email || '').toLowerCase() === HR_EMAIL.toLowerCase()
  );

  let userId = null;

  if (existingAuth) {
    userId = existingAuth.id;
    console.log(`[Idempotent Inspection] HR account already exists in Supabase Auth.`);
    console.log(`  User ID: ${userId}. Safely updating HR role metadata and password...`);

    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password: HR_DEFAULT_PASSWORD,
      app_metadata: { role: 'HR' },
      user_metadata: {
        ...existingAuth.user_metadata,
        role: 'HR',
        full_name: existingAuth.user_metadata?.full_name || 'HR Manager',
        must_change_password: existingAuth.user_metadata?.must_change_password ?? true,
      },
    });

    if (updateError) {
      console.warn('Warning updating existing HR auth user:', updateError.message);
    } else {
      console.log('  ✅ Existing HR Auth credentials and role metadata synchronized successfully.');
    }
  } else {
    // Persist securely to backend/.env if not present
    try {
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf-8');
        if (!envContent.includes('HR_ACCOUNT_PASSWORD=')) {
          envContent += `\nHR_ACCOUNT_PASSWORD=${HR_DEFAULT_PASSWORD}\n`;
          fs.writeFileSync(envPath, envContent, 'utf-8');
        }
      }
    } catch (e) {
      console.warn('Could not append to .env:', e.message);
    }

    console.log(`[Provisioning] Creating new HR Auth account in Supabase...`);
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: HR_EMAIL,
      password: HR_DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: 'HR Manager',
        role: 'HR',
        must_change_password: true,
      },
      app_metadata: {
        role: 'HR',
      },
    });

    if (createError) {
      throw new Error(`Failed to create HR auth user: ${createError.message}`);
    }

    userId = newUser.user.id;
    console.log(`✅ HR Auth user created successfully. ID: ${userId}`);
  }

  // 2. Ensure admin_users record exists
  const { data: existingProfile } = await supabase
    .from('admin_users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (!existingProfile) {
    console.log(`Linking profile in public.admin_users for ${HR_EMAIL}...`);
    let { error: insertErr } = await supabase.from('admin_users').insert([
      {
        id: userId,
        email: HR_EMAIL,
        full_name: 'HR Manager',
        role: 'HR',
        is_active: true,
      },
    ]);

    if (insertErr) {
      console.warn('Insert with role "HR" failed check constraint; retrying with "admin" fallback:', insertErr.message);
      const fallbackInsert = await supabase.from('admin_users').insert([
        {
          id: userId,
          email: HR_EMAIL,
          full_name: 'HR Manager',
          role: 'admin',
          is_active: true,
        },
      ]);
      if (fallbackInsert.error) {
        console.warn('Could not insert admin_users profile:', fallbackInsert.error.message);
      } else {
        console.log('✅ Created admin_users profile record (fallback role).');
      }
    } else {
      console.log('✅ Created admin_users profile record with role "HR".');
    }
  } else {
    // Update existing profile
    const { error: updateProfileErr } = await supabase
      .from('admin_users')
      .update({
        role: 'HR',
        full_name: existingProfile.full_name || 'HR Manager',
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateProfileErr) {
      console.warn('Could not update admin_users role to HR (likely check constraint); preserving existing profile:', updateProfileErr.message);
    } else {
      console.log('✅ Updated admin_users profile with role "HR".');
    }
  }

  console.log('--- HR User Setup Finished ---');
  return { userId, email: HR_EMAIL };
}

// Execute directly if run via CLI
if (process.argv[1] && process.argv[1].endsWith('ensure_hr_user.js')) {
  ensureHrAccount()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error setting up HR user:', err);
      process.exit(1);
    });
}
