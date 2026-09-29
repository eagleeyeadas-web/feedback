import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase URL or Service Role Key in backend/.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const ADMIN_EMAIL = 'eagleeye@gmail.com';
const ADMIN_PASSWORD = '123456';

async function createOrUpdateAdmin() {
  console.log(`Setting up Admin User: ${ADMIN_EMAIL} ...`);

  // 1. Check if user already exists in auth.users
  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
  
  if (listError) {
    console.error('Error listing users:', listError);
    return;
  }

  const existingUser = usersData.users.find(u => u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());

  let userId = null;

  if (existingUser) {
    console.log(`User ${ADMIN_EMAIL} exists with ID: ${existingUser.id}. Updating password...`);
    userId = existingUser.id;
    const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Eagle Eye Admin' },
    });

    if (updateError) {
      console.error('Error updating user password:', updateError);
      return;
    }
    console.log('Password updated successfully for existing user!');
  } else {
    console.log(`User ${ADMIN_EMAIL} does not exist. Creating new user...`);
    const { data: createData, error: createError } = await supabase.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Eagle Eye Admin' },
    });

    if (createError) {
      console.error('Error creating user:', createError);
      return;
    }
    userId = createData.user.id;
    console.log(`User created successfully with ID: ${userId}`);
  }

  // 2. Ensure entry in admin_users table
  console.log(`Ensuring record in admin_users table for ID: ${userId} ...`);
  const { data: adminRecord, error: adminError } = await supabase
    .from('admin_users')
    .upsert({
      id: userId,
      email: ADMIN_EMAIL,
      full_name: 'Eagle Eye Admin',
      role: 'super_admin',
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    .select();

  if (adminError) {
    console.error('Error updating admin_users table:', adminError);
  } else {
    console.log('admin_users table record updated successfully:', adminRecord);
  }

  console.log('\n======================================================');
  console.log('SUCCESS! Admin Credentials Configured:');
  console.log(`Email:    ${ADMIN_EMAIL}`);
  console.log(`Password: ${ADMIN_PASSWORD}`);
  console.log('======================================================');
}

createOrUpdateAdmin();
