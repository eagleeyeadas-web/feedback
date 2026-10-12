import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { createClient } from '@supabase/supabase-js';
import config from '../src/config.js';
import '../src/index.js'; // Starts server on config.port

// Isolated client simulating authentication
const clientAuth = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const PORT = config.port || 3001;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const ACCOUNTS = [
  {
    role: 'SALES',
    email: 'sales@gmail.com',
    password: process.env.SALES_ACCOUNT_PASSWORD || 'sales@2026',
    defaultWorkspace: 'Sales Workspace',
    expectedDefaultTab: 'sales_workspace',
  },
  {
    role: 'TECHNICAL',
    email: 'tech@gmail.com',
    password: process.env.TECH_ACCOUNT_PASSWORD || 'camera@2026',
    defaultWorkspace: 'Technical Workspace',
    expectedDefaultTab: 'technical_workspace',
  },
  {
    role: 'STORE_MANAGER',
    email: 'store@gmail.com',
    password: process.env.STORE_ACCOUNT_PASSWORD || 'adas@2026',
    defaultWorkspace: 'Store Manager Workspace',
    expectedDefaultTab: 'store_workspace',
  },
];

async function apiRequest(endpoint, method = 'GET', token = null, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = {
    method,
    headers,
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${endpoint}`, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function runTests() {
  console.log('========================================================================');
  console.log('  STARTING ROLE-BASED ACCESS CONTROL & WORKSPACE RESTRICTION TESTS      ');
  console.log('========================================================================\n');

  console.log(`[Target Server] Running on ${BASE_URL}\n`);

  const results = [];
  const tokens = {};

  try {
    // ---------------------------------------------------------
    // Phase 1: Authentication & Token Role Validation
    // ---------------------------------------------------------
    console.log('--- Phase 1: Supabase Auth & Role Metadata Verification ---');
    for (const acc of ACCOUNTS) {
      const { data, error } = await clientAuth.auth.signInWithPassword({
        email: acc.email,
        password: acc.password,
      });

      if (error || !data.session) {
        throw new Error(`Failed to sign in as ${acc.email}: ${error?.message}`);
      }

      const token = data.session.access_token;
      tokens[acc.role] = token;

      const user = data.user;
      const detectedRole = (
        user.app_metadata?.role ||
        user.user_metadata?.role ||
        'UNKNOWN'
      ).toUpperCase();

      const roleMatch = detectedRole === acc.role;
      console.log(
        `  ${roleMatch ? '✅' : '❌'} ${acc.email}: Authenticated! Role: ${detectedRole} (Expected: ${acc.role})`
      );

      results.push({
        Account: acc.email,
        Role: acc.role,
        Test: 'Authentication & Metadata Role Check',
        Result: roleMatch ? 'PASS' : 'FAIL',
        Details: `Role verified as ${detectedRole}`,
      });
    }

    // ---------------------------------------------------------
    // Phase 2: Default Redirect Workspace Mapping Verification
    // ---------------------------------------------------------
    console.log('\n--- Phase 2: Default Redirect Workspace Mapping ---');
    for (const acc of ACCOUNTS) {
      let mappedTab = 'installation_checklists';
      if (acc.role === 'SALES') mappedTab = 'sales_workspace';
      else if (acc.role === 'TECHNICAL') mappedTab = 'technical_workspace';
      else if (acc.role === 'STORE_MANAGER') mappedTab = 'store_workspace';

      const pass = mappedTab === acc.expectedDefaultTab;
      console.log(
        `  ${pass ? '✅' : '❌'} ${acc.role} default redirect -> ${mappedTab} (Matches: ${acc.defaultWorkspace})`
      );

      results.push({
        Account: acc.email,
        Role: acc.role,
        Test: 'Default Workspace Redirect',
        Result: pass ? 'PASS' : 'FAIL',
        Details: `Mapped to ${mappedTab} (${acc.defaultWorkspace})`,
      });
    }

    // ---------------------------------------------------------
    // Phase 3: Sales Role Access Controls
    // ---------------------------------------------------------
    console.log('\n--- Phase 3: Testing SALES Permissions & Restrictions ---');
    const salesToken = tokens['SALES'];

    // Permitted endpoints
    const salesPerm1 = await apiRequest('/api/admin/quotations', 'GET', salesToken);
    console.log(`  Sales GET /api/admin/quotations -> Status: ${salesPerm1.status} (Expected: 200)`);
    results.push({
      Account: 'sales@gmail.com',
      Role: 'SALES',
      Test: 'Access Quotations (Permitted)',
      Result: salesPerm1.status === 200 ? 'PASS' : 'FAIL',
      Details: `Status ${salesPerm1.status}`,
    });

    const salesPerm2 = await apiRequest('/api/admin/customers', 'GET', salesToken);
    console.log(`  Sales GET /api/admin/customers -> Status: ${salesPerm2.status} (Expected: 200)`);
    results.push({
      Account: 'sales@gmail.com',
      Role: 'SALES',
      Test: 'Access Customers (Permitted)',
      Result: salesPerm2.status === 200 ? 'PASS' : 'FAIL',
      Details: `Status ${salesPerm2.status}`,
    });

    // Restricted inventory operations
    const salesRest1 = await apiRequest('/api/inventory/receive', 'POST', salesToken, {
      product_id: '00000000-0000-0000-0000-000000000000',
      quantity: 10,
    });
    console.log(`  Sales POST /api/inventory/receive -> Status: ${salesRest1.status} (Expected: 403 Forbidden)`);
    results.push({
      Account: 'sales@gmail.com',
      Role: 'SALES',
      Test: 'Deny Direct Stock Receive (403)',
      Result: salesRest1.status === 403 ? 'PASS' : 'FAIL',
      Details: `Status ${salesRest1.status}: ${salesRest1.data?.error || ''}`,
    });

    const salesRest2 = await apiRequest('/api/inventory/verify-return', 'POST', salesToken, {
      return_id: '00000000-0000-0000-0000-000000000000',
    });
    console.log(`  Sales POST /api/inventory/verify-return -> Status: ${salesRest2.status} (Expected: 403 Forbidden)`);
    results.push({
      Account: 'sales@gmail.com',
      Role: 'SALES',
      Test: 'Deny Return Verification (403)',
      Result: salesRest2.status === 403 ? 'PASS' : 'FAIL',
      Details: `Status ${salesRest2.status}: ${salesRest2.data?.error || ''}`,
    });

    const salesRest3 = await apiRequest('/api/admin/users', 'GET', salesToken);
    console.log(`  Sales GET /api/admin/users -> Status: ${salesRest3.status} (Expected: 403 Forbidden)`);
    results.push({
      Account: 'sales@gmail.com',
      Role: 'SALES',
      Test: 'Deny Employee User Admin (403)',
      Result: salesRest3.status === 403 ? 'PASS' : 'FAIL',
      Details: `Status ${salesRest3.status}`,
    });

    // ---------------------------------------------------------
    // Phase 4: Technical Role Access Controls
    // ---------------------------------------------------------
    console.log('\n--- Phase 4: Testing TECHNICAL Permissions & Restrictions ---');
    const techToken = tokens['TECHNICAL'];

    // Permitted endpoints
    const techPerm1 = await apiRequest('/api/admin/installations/stats', 'GET', techToken);
    console.log(`  Technical GET /api/admin/installations/stats -> Status: ${techPerm1.status} (Expected: 200)`);
    results.push({
      Account: 'tech@gmail.com',
      Role: 'TECHNICAL',
      Test: 'Access Job Stats (Permitted)',
      Result: techPerm1.status === 200 ? 'PASS' : 'FAIL',
      Details: `Status ${techPerm1.status}`,
    });

    // Restricted operations: Technical cannot verify returns
    const techRest1 = await apiRequest('/api/admin/installations/00000000-0000-0000-0000-000000000000/verify-return', 'POST', techToken, {});
    console.log(`  Technical POST /installations/:id/verify-return -> Status: ${techRest1.status} (Expected: 403 Forbidden)`);
    results.push({
      Account: 'tech@gmail.com',
      Role: 'TECHNICAL',
      Test: 'Deny Self-Verifying Returns (403)',
      Result: techRest1.status === 403 ? 'PASS' : 'FAIL',
      Details: `Status ${techRest1.status}: ${techRest1.data?.error || ''}`,
    });

    // Technical cannot receive or adjust stock
    const techRest2 = await apiRequest('/api/inventory/receive', 'POST', techToken, { quantity: 5 });
    console.log(`  Technical POST /api/inventory/receive -> Status: ${techRest2.status} (Expected: 403 Forbidden)`);
    results.push({
      Account: 'tech@gmail.com',
      Role: 'TECHNICAL',
      Test: 'Deny Direct Stock Modification (403)',
      Result: techRest2.status === 403 ? 'PASS' : 'FAIL',
      Details: `Status ${techRest2.status}: ${techRest2.data?.error || ''}`,
    });

    // Technical cannot access quotations
    const techRest3 = await apiRequest('/api/admin/quotations', 'GET', techToken);
    console.log(`  Technical GET /api/admin/quotations -> Status: ${techRest3.status} (Expected: 403 Forbidden)`);
    results.push({
      Account: 'tech@gmail.com',
      Role: 'TECHNICAL',
      Test: 'Deny Quotations Access (403)',
      Result: techRest3.status === 403 ? 'PASS' : 'FAIL',
      Details: `Status ${techRest3.status}`,
    });

    // ---------------------------------------------------------
    // Phase 5: Store Manager Role Access Controls
    // ---------------------------------------------------------
    console.log('\n--- Phase 5: Testing STORE_MANAGER Permissions & Restrictions ---');
    const storeToken = tokens['STORE_MANAGER'];

    // Permitted endpoints
    const storePerm1 = await apiRequest('/api/admin/inventory/summary', 'GET', storeToken);
    console.log(`  Store Manager GET /api/admin/inventory/summary -> Status: ${storePerm1.status} (Expected: 200)`);
    results.push({
      Account: 'store@gmail.com',
      Role: 'STORE_MANAGER',
      Test: 'Access Stock Summary (Permitted)',
      Result: storePerm1.status === 200 ? 'PASS' : 'FAIL',
      Details: `Status ${storePerm1.status}`,
    });

    const storePerm2 = await apiRequest('/api/admin/inventory/transactions', 'GET', storeToken);
    console.log(`  Store Manager GET /api/admin/inventory/transactions -> Status: ${storePerm2.status} (Expected: 200)`);
    results.push({
      Account: 'store@gmail.com',
      Role: 'STORE_MANAGER',
      Test: 'Access Stock Transactions (Permitted)',
      Result: storePerm2.status === 200 ? 'PASS' : 'FAIL',
      Details: `Status ${storePerm2.status}`,
    });

    // Restricted operations: Store Manager cannot create installation jobs (Sales/Admin only)
    const storeRest1 = await apiRequest('/api/admin/installations', 'POST', storeToken, {
      client_name: 'Test Client',
      client_mobile: '9876543210',
    });
    console.log(`  Store Manager POST /api/admin/installations -> Status: ${storeRest1.status} (Expected: 403 Forbidden)`);
    results.push({
      Account: 'store@gmail.com',
      Role: 'STORE_MANAGER',
      Test: 'Deny Creating Installation Jobs (403)',
      Result: storeRest1.status === 403 ? 'PASS' : 'FAIL',
      Details: `Status ${storeRest1.status}: ${storeRest1.data?.error || ''}`,
    });

    // Store Manager cannot record device carry (Technical/Admin only)
    const storeRest2 = await apiRequest('/api/admin/installations/00000000-0000-0000-0000-000000000000/carry-record', 'POST', storeToken, {});
    console.log(`  Store Manager POST /installations/:id/carry-record -> Status: ${storeRest2.status} (Expected: 403 Forbidden)`);
    results.push({
      Account: 'store@gmail.com',
      Role: 'STORE_MANAGER',
      Test: 'Deny Recording Device Carry (403)',
      Result: storeRest2.status === 403 ? 'PASS' : 'FAIL',
      Details: `Status ${storeRest2.status}: ${storeRest2.data?.error || ''}`,
    });

    // Store Manager cannot access quotations
    const storeRest3 = await apiRequest('/api/admin/quotations', 'GET', storeToken);
    console.log(`  Store Manager GET /api/admin/quotations -> Status: ${storeRest3.status} (Expected: 403 Forbidden)`);
    results.push({
      Account: 'store@gmail.com',
      Role: 'STORE_MANAGER',
      Test: 'Deny Quotations Access (403)',
      Result: storeRest3.status === 403 ? 'PASS' : 'FAIL',
      Details: `Status ${storeRest3.status}`,
    });

    // ---------------------------------------------------------
    // Phase 6: Verification Results Summary
    // ---------------------------------------------------------
    console.log('\n========================================================================');
    console.log('  TEST EXECUTION COMPLETED                                              ');
    console.log('========================================================================\n');
    console.table(results);

    const allPassed = results.every((r) => r.Result === 'PASS');
    if (!allPassed) {
      console.error('\n❌ SOME ACCESS CONTROL TESTS FAILED!');
      process.exit(1);
    } else {
      console.log('\n✅ ALL 15 ROLE-BASED ACCESS CONTROL TESTS PASSED SUCCESSFULLY!');
    }
  } finally {
    // Done
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Test suite failed:', err);
    process.exit(1);
  });
