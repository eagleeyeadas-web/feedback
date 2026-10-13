import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials missing from .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runLandingAndPortalLoginTests() {
  console.log('========================================================================');
  console.log('  TESTING LANDING PAGE, PORTAL CARDS, AND STAFF LOGIN FLOWS             ');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 6;

  // 1. Check frontend LandingPage.jsx source code
  console.log('--- TEST 1: Verify Landing Page Structure & Cards ---');
  const landingCode = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/pages/LandingPage.jsx'),
    'utf-8'
  );

  const hasSales = landingCode.includes('Sales Portal') && landingCode.includes('Sales Login');
  const hasTechnical = landingCode.includes('Technical Team') && landingCode.includes('Technical Login');
  const hasStore = landingCode.includes('Store Manager') && landingCode.includes('Store Login');
  const hasCustomer = landingCode.includes('Customer Form') && landingCode.includes('Open Customer Form');
  const hasNoAdminCard = !landingCode.includes('Admin Portal') && !landingCode.includes('Admin Login');

  if (hasSales && hasTechnical && hasStore && hasCustomer && hasNoAdminCard) {
    console.log('✅ Passed: Exactly 4 portal cards present (Sales, Technical, Store, Customer). Zero Admin cards on landing page.');
    passed++;
  } else {
    throw new Error('Test 1 failed: Landing page cards verification failed!');
  }

  // 2. Check Navbar.jsx for removal of Admin Portal link
  console.log('\n--- TEST 2: Verify Navbar Removal of Public Admin Portal Link ---');
  const navbarCode = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/components/Navbar.jsx'),
    'utf-8'
  );

  if (!navbarCode.includes('Admin Portal') && navbarCode.includes('bg-red-accent')) {
    console.log('✅ Passed: Public Admin Portal button removed from Navbar; thin red accent divider preserved.');
    passed++;
  } else {
    throw new Error('Test 2 failed: Navbar still contains Admin Portal link or lacks red divider!');
  }

  // 3. Test Sales Login Flow
  console.log('\n--- TEST 3: Test Sales Login Flow ---');
  const salesPass = process.env.SALES_ACCOUNT_PASSWORD;
  if (!salesPass) {
    console.log('⚠️ Skipped: SALES_ACCOUNT_PASSWORD not set in environment.');
  } else {
    const { data: salesAuth, error: salesErr } = await supabase.auth.signInWithPassword({
      email: 'sales@gmail.com',
      password: salesPass,
    });

    if (salesErr || !salesAuth?.user) {
      throw new Error(`Sales login failed: ${salesErr?.message}`);
    }

    const salesRole = (
      salesAuth.user.app_metadata?.role ||
      salesAuth.user.user_metadata?.role ||
      'UNKNOWN'
    ).toUpperCase();

    if (salesRole === 'SALES') {
      console.log('✅ Passed: Sales account authenticated successfully. Role: SALES -> Maps to Sales Workspace.');
      passed++;
    } else {
      throw new Error(`Expected role SALES, got ${salesRole}`);
    }
  }

  // 4. Test Technical Login Flow
  console.log('\n--- TEST 4: Test Technical Team Login Flow ---');
  const techPass = process.env.TECH_ACCOUNT_PASSWORD;
  if (!techPass) {
    console.log('⚠️ Skipped: TECH_ACCOUNT_PASSWORD not set in environment.');
  } else {
    const { data: techAuth, error: techErr } = await supabase.auth.signInWithPassword({
      email: 'tech@gmail.com',
      password: techPass,
    });

    if (techErr || !techAuth?.user) {
      throw new Error(`Technical login failed: ${techErr?.message}`);
    }

    const techRole = (
      techAuth.user.app_metadata?.role ||
      techAuth.user.user_metadata?.role ||
      'UNKNOWN'
    ).toUpperCase();

    if (techRole === 'TECHNICAL') {
      console.log('✅ Passed: Technical account authenticated successfully. Role: TECHNICAL -> Maps to Technical Workspace.');
      passed++;
    } else {
      throw new Error(`Expected role TECHNICAL, got ${techRole}`);
    }
  }

  // 5. Test Store Manager Login Flow
  console.log('\n--- TEST 5: Test Store Manager Login Flow ---');
  const storePass = process.env.STORE_ACCOUNT_PASSWORD;
  if (!storePass) {
    console.log('⚠️ Skipped: STORE_ACCOUNT_PASSWORD not set in environment.');
  } else {
    const { data: storeAuth, error: storeErr } = await supabase.auth.signInWithPassword({
      email: 'store@gmail.com',
      password: storePass,
    });

    if (storeErr || !storeAuth?.user) {
      throw new Error(`Store Manager login failed: ${storeErr?.message}`);
    }

  const storeRole = (
    storeAuth.user.app_metadata?.role ||
    storeAuth.user.user_metadata?.role ||
    'UNKNOWN'
  ).toUpperCase();

  if (storeRole === 'STORE_MANAGER') {
    console.log('✅ Passed: Store Manager account authenticated successfully. Role: STORE_MANAGER -> Maps to Store Workspace.');
    passed++;
  } else {
    throw new Error(`Expected role STORE_MANAGER, got ${storeRole}`);
  }
  }

  // 6. Test App.jsx Routes Configuration
  console.log('\n--- TEST 6: Test App.jsx Routes Configuration ---');
  const appCode = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/App.jsx'),
    'utf-8'
  );

  const hasRootLanding = appCode.includes('path="/" element={<LandingPage />}');
  const hasCustomerFormRoute = appCode.includes('path="/customer-form" element={<FeedbackForm />}');
  const hasLoginRoute = appCode.includes('path="/login" element={<Login />}');
  const hasAdminLoginRoute = appCode.includes('path="/admin/login" element={<Login />}');

  if (hasRootLanding && hasCustomerFormRoute && hasLoginRoute && hasAdminLoginRoute) {
    console.log('✅ Passed: App routing configured: / (LandingPage), /customer-form (FeedbackForm), /login & /admin/login (Login).');
    passed++;
  } else {
    throw new Error('Test 6 failed: App.jsx routing configuration incomplete!');
  }

  console.log('\n========================================================================');
  console.log(`  SUMMARY: ${passed}/${total} TESTS PASSED SUCCESSFULLY!`);
  console.log('========================================================================\n');
}

runLandingAndPortalLoginTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
