import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import supabase from '../src/services/supabase.js';

function getAccountPassword(envVar, roleName) {
  const pwd = process.env[envVar];
  if (!pwd) {
    throw new Error(`Environment variable ${envVar} is required to provision the ${roleName} account. Please define it in backend/.env.`);
  }
  return pwd;
}

// Account definitions to provision (passwords supplied via environment variables)
function getTargetAccounts() {
  return [
    {
      email: 'sales@gmail.com',
      password: getAccountPassword('SALES_ACCOUNT_PASSWORD', 'SALES'),
      role: 'SALES',
      fullName: 'Sales Executive',
      defaultWorkspace: 'Sales Workspace',
    },
    {
      email: 'tech@gmail.com',
      password: getAccountPassword('TECH_ACCOUNT_PASSWORD', 'TECHNICAL'),
      role: 'TECHNICAL',
      fullName: 'Service Engineer',
      defaultWorkspace: 'Technical Workspace',
    },
    {
      email: 'store@gmail.com',
      password: getAccountPassword('STORE_ACCOUNT_PASSWORD', 'STORE_MANAGER'),
      role: 'STORE_MANAGER',
      fullName: 'Store Manager',
      defaultWorkspace: 'Store Manager Workspace',
    },
    {
      email: 'coordinator@gmail.com',
      password: getAccountPassword('COORDINATOR_ACCOUNT_PASSWORD', 'COORDINATOR'),
      role: 'COORDINATOR',
      fullName: 'Travel & Accommodation Coordinator',
      defaultWorkspace: 'Coordinator Workspace',
    },
  ];
}

export async function provisionAccounts() {
  console.log('================================================================');
  console.log('  PROVISIONING DEDICATED ROLE-BASED ACCOUNTS                    ');
  console.log('================================================================\n');

  // 1. Fetch all existing Auth users
  const { data: authList, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    throw new Error(`Failed to list existing auth users: ${listError.message}`);
  }

  const existingAuthUsers = authList?.users || [];
  const results = [];

  const targetAccounts = getTargetAccounts();
  for (const account of targetAccounts) {
    const existing = existingAuthUsers.find(
      (u) => u.email?.toLowerCase() === account.email.toLowerCase()
    );

    let userId = existing ? existing.id : null;
    let authCreated = false;

    if (!existing) {
      console.log(`[Provisioning] Creating Auth account for: ${account.email} (Role: ${account.role})...`);
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: account.email,
        password: account.password,
        email_confirm: true,
        user_metadata: {
          full_name: account.fullName,
          role: account.role,
        },
        app_metadata: {
          role: account.role,
        },
      });

      if (createError) {
        throw new Error(`Failed to create auth user ${account.email}: ${createError.message}`);
      }

      userId = newUser.user.id;
      authCreated = true;
      console.log(`  ✅ Auth user created successfully. ID: ${userId}`);
    } else {
      console.log(`[Idempotent Check] Auth user already exists: ${account.email} (ID: ${userId}).`);
      // Update app_metadata and user_metadata with authoritative role
      console.log(`  Ensuring authoritative role metadata: ${account.role}...`);
      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...existing.user_metadata,
          full_name: account.fullName,
          role: account.role,
        },
        app_metadata: {
          ...existing.app_metadata,
          role: account.role,
        },
      });
    }

    // 2. Ensure profile exists in public.admin_users
    const { data: existingProfile, error: profileFetchErr } = await supabase
      .from('admin_users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (profileFetchErr) {
      console.warn(`  Warning fetching admin_users profile:`, profileFetchErr.message);
    }

    if (!existingProfile) {
      console.log(`  Inserting profile into public.admin_users for ${account.email}...`);
      const { error: insertProfileErr } = await supabase.from('admin_users').insert([
        {
          id: userId,
          email: account.email,
          full_name: account.fullName,
          role: 'admin',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);

      if (insertProfileErr) {
        throw new Error(`Failed to insert admin_users profile for ${account.email}: ${insertProfileErr.message}`);
      }
      console.log(`  ✅ admin_users profile linked for user ID: ${userId}`);
    } else {
      console.log(`  Profile exists in admin_users (is_active: ${existingProfile.is_active})`);
      if (existingProfile.is_active === false) {
        await supabase
          .from('admin_users')
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .eq('id', userId);
        console.log(`  Activated admin_users account.`);
      }
    }

    // 3. Verify that the user can authenticate with the credentials
    console.log(`  Verifying password authentication for ${account.email}...`);
    const { data: authSession, error: signInErr } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });

    if (signInErr || !authSession.session) {
      throw new Error(`Auth verification failed for ${account.email}: ${signInErr?.message}`);
    }
    console.log(`  ✅ Authentication verified successfully! JWT received.`);

    // Sign out verification session
    await supabase.auth.signOut();

    results.push({
      email: account.email,
      role: account.role,
      defaultWorkspace: account.defaultWorkspace,
      id: userId,
      verified: true,
    });
  }

  console.log('\n================================================================');
  console.log('  PROVISIONING COMPLETED SUCCESSFULLY!                          ');
  console.log('================================================================');
  console.table(results);
  return results;
}

// Execute if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  provisionAccounts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ Provisioning failed:', err.message);
      process.exit(1);
    });
}
