import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import supabase from '../src/services/supabase.js';

export async function ensureCoordinatorAccount() {
  console.log('--- Checking Coordinator Account (coordinator@gmail.com) ---');

  // 1. List existing auth users
  const { data: authList, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    throw new Error(`Failed to list auth users: ${listError.message}`);
  }

  const existingAuth = (authList?.users || []).find(
    (u) => (u.email || '').toLowerCase() === 'coordinator@gmail.com'
  );

  let userId = null;

  if (existingAuth) {
    userId = existingAuth.id;
    console.log(`[Idempotent Inspection] Coordinator account already exists in Supabase Auth.`);
    console.log(`  User ID: ${userId}. Reusing existing credentials without destructive reset.`);

    // Ensure role metadata is set to COORDINATOR
    await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { role: 'COORDINATOR' },
      user_metadata: {
        ...existingAuth.user_metadata,
        role: 'COORDINATOR',
        full_name: existingAuth.user_metadata?.full_name || 'Travel & Accommodation Coordinator',
      },
    });
  } else {
    // Determine password
    let password = process.env.COORDINATOR_ACCOUNT_PASSWORD || 'booking@2026';

      // Persist securely to backend/.env (gitignored)
      try {
        if (fs.existsSync(envPath)) {
          let envContent = fs.readFileSync(envPath, 'utf-8');
          if (!envContent.includes('COORDINATOR_ACCOUNT_PASSWORD=')) {
            envContent += `\nCOORDINATOR_ACCOUNT_PASSWORD=${password}\n`;
            fs.writeFileSync(envPath, envContent, 'utf-8');
          }
        }
      } catch (e) {
        console.warn('Could not append to .env:', e.message);
      }
    }

    console.log(`[Provisioning] Creating new Coordinator Auth account in Supabase...`);
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: 'coordinator@gmail.com',
      password,
      email_confirm: true,
      user_metadata: {
        full_name: 'Travel & Accommodation Coordinator',
        role: 'COORDINATOR',
        must_change_password: true,
      },
      app_metadata: {
        role: 'COORDINATOR',
      },
    });

    if (createError) {
      throw new Error(`Failed to create coordinator auth user: ${createError.message}`);
    }

    userId = newUser.user.id;
    console.log(`✅ Coordinator Auth user created successfully. ID: ${userId}`);
  }

  // 2. Ensure admin_users record exists
  const { data: existingProfile } = await supabase
    .from('admin_users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (!existingProfile) {
    console.log(`Linking profile in public.admin_users for coordinator@gmail.com...`);
    // Attempt role: 'COORDINATOR', fallback to 'admin' if check constraint is legacy
    let { error: insertErr } = await supabase.from('admin_users').insert([
      {
        id: userId,
        email: 'coordinator@gmail.com',
        full_name: 'Travel & Accommodation Coordinator',
        role: 'COORDINATOR',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    if (insertErr) {
      console.warn('Direct role COORDINATOR insert blocked by constraint, using admin fallback:', insertErr.message);
      const fallbackInsert = await supabase.from('admin_users').insert([
        {
          id: userId,
          email: 'coordinator@gmail.com',
          full_name: 'Travel & Accommodation Coordinator',
          role: 'admin',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
      if (fallbackInsert.error) {
        console.warn('Could not insert admin_users row:', fallbackInsert.error.message);
      } else {
        console.log(`✅ admin_users linked with role 'admin' (authoritative role COORDINATOR enforced via auth identity)`);
      }
    } else {
      console.log(`✅ admin_users linked with role 'COORDINATOR'`);
    }
  } else {
    console.log(`admin_users profile exists (is_active: ${existingProfile.is_active}). Ensuring active status.`);
    await supabase
      .from('admin_users')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', userId);
  }

  return { email: 'coordinator@gmail.com', id: userId, role: 'COORDINATOR' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensureCoordinatorAccount()
    .then(() => {
      console.log('Coordinator account ready.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Provisioning failed:', err);
      process.exit(1);
    });
}
