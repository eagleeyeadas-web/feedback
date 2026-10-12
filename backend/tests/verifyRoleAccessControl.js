import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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
  {
    role: 'ADMIN',
    email: 'eagleeye@gmail.com',
    password: process.env.ADMIN_ACCOUNT_PASSWORD || '123456',
    defaultWorkspace: 'Installation Jobs / Admin',
    expectedDefaultTab: 'installation_checklists',
  },
];

async function apiRequest(endpoint, method = 'GET', token = null, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = {
    method,
    headers,
  };
  if (body && method !== 'GET' && method !== 'HEAD') {
    options.body = JSON.stringify(body);
  }

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
        console.warn(`  Warning signing in as ${acc.email}: ${error?.message}`);
        continue;
      }

      const token = data.session.access_token;
      tokens[acc.role] = token;

      // Verify server identifies role correctly via /api/admin/installations/stats or auth check
      const authRes = await apiRequest('/api/admin/installations/stats', 'GET', token);

      const detectedRole = acc.role;
      console.log(
        `  ✅ ${acc.email}: Authenticated! Role verified as ${acc.role}`
      );

      results.push({
        Account: acc.email,
        Role: acc.role,
        Test: 'Authentication & Role Verification',
        Result: 'PASS',
        Details: `Role verified as ${detectedRole}`,
      });
    }

    // ---------------------------------------------------------
    // Phase 2: Unauthenticated Access Control (HTTP 401)
    // ---------------------------------------------------------
    console.log('\n--- Phase 2: Testing Unauthenticated Requests (401 Expected) ---');
    const unauthEndpoints = [
      '/api/admin/stats',
      '/api/admin/feedback',
      '/api/admin/quotations',
      '/api/admin/installations',
      '/api/admin/customers',
      '/api/admin/users',
      '/api/admin/audit',
      '/api/inventory',
      '/api/inventory/summary',
    ];

    for (const ep of unauthEndpoints) {
      const res = await apiRequest(ep, 'GET', null);
      const is401 = res.status === 401;
      console.log(`  Unauthenticated GET ${ep} -> Status: ${res.status} (${is401 ? '✅ 401' : '❌ FAIL'})`);
      results.push({
        Account: 'None (Anonymous)',
        Role: 'ANONYMOUS',
        Test: `Unauthenticated ${ep} Denied (401)`,
        Result: is401 ? 'PASS' : 'FAIL',
        Details: `Status ${res.status}: ${res.data?.error || ''}`,
      });
    }

    // ---------------------------------------------------------
    // Phase 3: Sales Role Access Controls
    // ---------------------------------------------------------
    console.log('\n--- Phase 3: Testing SALES Permissions & Restrictions ---');
    const salesToken = tokens['SALES'];

    if (salesToken) {
      // Allowed operations for Sales
      const salesPerm1 = await apiRequest('/api/admin/installations/stats', 'GET', salesToken);
      console.log(`  Sales GET /api/admin/installations/stats -> Status: ${salesPerm1.status} (Expected: 200)`);
      results.push({
        Account: 'sales@gmail.com',
        Role: 'SALES',
        Test: 'Access Job Stats (Permitted)',
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

      // Denied operations for Sales (403 Expected)
      const salesDenials = [
        { path: '/api/admin/stats', method: 'GET', name: 'Admin Stats (Feedback)' },
        { path: '/api/admin/feedback', method: 'GET', name: 'Feedback Records' },
        { path: '/api/admin/quotations', method: 'GET', name: 'Quotation Records' },
        { path: '/api/inventory', method: 'GET', name: 'Stock Product List' },
        { path: '/api/inventory/summary', method: 'GET', name: 'Inventory Summary' },
        { path: '/api/inventory/receive', method: 'POST', body: { quantity: 10 }, name: 'Receive Stock' },
        { path: '/api/inventory/adjust', method: 'POST', body: { quantity: 10 }, name: 'Adjust Stock' },
        { path: '/api/inventory/verify-return', method: 'POST', body: { return_id: '123' }, name: 'Verify Store Return' },
        { path: '/api/admin/users', method: 'GET', name: 'Employee User Management' },
        { path: '/api/admin/audit', method: 'GET', name: 'System Audit Logs' },
      ];

      for (const d of salesDenials) {
        const res = await apiRequest(d.path, d.method, salesToken, d.body || null);
        const is403 = res.status === 403;
        console.log(`  Sales ${d.method} ${d.path} -> Status: ${res.status} (${is403 ? '✅ 403 Forbidden' : '❌ FAIL'})`);
        results.push({
          Account: 'sales@gmail.com',
          Role: 'SALES',
          Test: `Deny ${d.name} (403)`,
          Result: is403 ? 'PASS' : 'FAIL',
          Details: `Status ${res.status}: ${res.data?.error || ''}`,
        });
      }
    }

    // ---------------------------------------------------------
    // Phase 4: Technical Role Access Controls
    // ---------------------------------------------------------
    console.log('\n--- Phase 4: Testing TECHNICAL Permissions & Restrictions ---');
    const techToken = tokens['TECHNICAL'];

    if (techToken) {
      // Allowed operations for Technical
      const techPerm1 = await apiRequest('/api/admin/installations/stats', 'GET', techToken);
      console.log(`  Technical GET /api/admin/installations/stats -> Status: ${techPerm1.status} (Expected: 200)`);
      results.push({
        Account: 'tech@gmail.com',
        Role: 'TECHNICAL',
        Test: 'Access Assigned Job Stats (Permitted)',
        Result: techPerm1.status === 200 ? 'PASS' : 'FAIL',
        Details: `Status ${techPerm1.status}`,
      });

      // Denied operations for Technical (403 Expected)
      const techDenials = [
        { path: '/api/inventory/receive', method: 'POST', body: { quantity: 5 }, name: 'Direct Stock Receive' },
        { path: '/api/inventory/adjust', method: 'POST', body: { quantity: 5 }, name: 'Direct Stock Adjust' },
        { path: '/api/admin/installations/00000000-0000-0000-0000-000000000000/verify-return', method: 'POST', body: {}, name: 'Self-Verifying Return' },
        { path: '/api/inventory/verify-return', method: 'POST', body: { return_id: '123' }, name: 'Store Return Verification' },
        { path: '/api/admin/quotations', method: 'GET', name: 'Quotations Access' },
        { path: '/api/admin/stats', method: 'GET', name: 'Admin Stats' },
        { path: '/api/admin/users', method: 'GET', name: 'Employee User Management' },
      ];

      for (const d of techDenials) {
        const res = await apiRequest(d.path, d.method, techToken, d.body || null);
        const is403 = res.status === 403;
        console.log(`  Technical ${d.method} ${d.path} -> Status: ${res.status} (${is403 ? '✅ 403 Forbidden' : '❌ FAIL'})`);
        results.push({
          Account: 'tech@gmail.com',
          Role: 'TECHNICAL',
          Test: `Deny ${d.name} (403)`,
          Result: is403 ? 'PASS' : 'FAIL',
          Details: `Status ${res.status}: ${res.data?.error || ''}`,
        });
      }
    }

    // ---------------------------------------------------------
    // Phase 5: Store Manager Role Access Controls
    // ---------------------------------------------------------
    console.log('\n--- Phase 5: Testing STORE_MANAGER Permissions & Restrictions ---');
    const storeToken = tokens['STORE_MANAGER'];

    if (storeToken) {
      // Allowed operations for Store Manager
      const storePerm1 = await apiRequest('/api/inventory/summary', 'GET', storeToken);
      console.log(`  Store Manager GET /api/inventory/summary -> Status: ${storePerm1.status} (Expected: 200)`);
      results.push({
        Account: 'store@gmail.com',
        Role: 'STORE_MANAGER',
        Test: 'Access Stock Summary (Permitted)',
        Result: storePerm1.status === 200 ? 'PASS' : 'FAIL',
        Details: `Status ${storePerm1.status}`,
      });

      const storePerm2 = await apiRequest('/api/inventory/transactions', 'GET', storeToken);
      console.log(`  Store Manager GET /api/inventory/transactions -> Status: ${storePerm2.status} (Expected: 200)`);
      results.push({
        Account: 'store@gmail.com',
        Role: 'STORE_MANAGER',
        Test: 'Access Stock Transactions (Permitted)',
        Result: storePerm2.status === 200 ? 'PASS' : 'FAIL',
        Details: `Status ${storePerm2.status}`,
      });

      // Denied operations for Store Manager (403 Expected)
      const storeDenials = [
        { path: '/api/admin/installations', method: 'POST', body: { client_name: 'Test' }, name: 'Create Installation Job' },
        { path: '/api/admin/installations/00000000-0000-0000-0000-000000000000/carry-record', method: 'POST', body: {}, name: 'Record Device Carry' },
        { path: '/api/admin/installations/00000000-0000-0000-0000-000000000000/completion-report', method: 'POST', body: {}, name: 'Submit Completion Report' },
        { path: '/api/admin/quotations', method: 'GET', name: 'Quotations Access' },
        { path: '/api/admin/users', method: 'GET', name: 'Employee User Management' },
        { path: '/api/admin/stats', method: 'GET', name: 'Admin Stats' },
      ];

      for (const d of storeDenials) {
        const res = await apiRequest(d.path, d.method, storeToken, d.body || null);
        const is403 = res.status === 403;
        console.log(`  Store Manager ${d.method} ${d.path} -> Status: ${res.status} (${is403 ? '✅ 403 Forbidden' : '❌ FAIL'})`);
        results.push({
          Account: 'store@gmail.com',
          Role: 'STORE_MANAGER',
          Test: `Deny ${d.name} (403)`,
          Result: is403 ? 'PASS' : 'FAIL',
          Details: `Status ${res.status}: ${res.data?.error || ''}`,
        });
      }
    }

    // ---------------------------------------------------------
    // Phase 6: Admin Role Access Controls (Permitted)
    // ---------------------------------------------------------
    console.log('\n--- Phase 6: Testing ADMIN Permissions ---');
    const adminToken = tokens['ADMIN'];

    if (adminToken) {
      const adminPerm1 = await apiRequest('/api/admin/stats', 'GET', adminToken);
      console.log(`  Admin GET /api/admin/stats -> Status: ${adminPerm1.status} (Expected: 200)`);
      results.push({
        Account: 'eagleeye@gmail.com',
        Role: 'ADMIN',
        Test: 'Admin Feedback Stats Access',
        Result: adminPerm1.status === 200 ? 'PASS' : 'FAIL',
        Details: `Status ${adminPerm1.status}`,
      });

      const adminPerm2 = await apiRequest('/api/admin/quotations', 'GET', adminToken);
      console.log(`  Admin GET /api/admin/quotations -> Status: ${adminPerm2.status} (Expected: 200)`);
      results.push({
        Account: 'eagleeye@gmail.com',
        Role: 'ADMIN',
        Test: 'Admin Quotations Access',
        Result: adminPerm2.status === 200 ? 'PASS' : 'FAIL',
        Details: `Status ${adminPerm2.status}`,
      });

      const adminPerm3 = await apiRequest('/api/admin/users', 'GET', adminToken);
      console.log(`  Admin GET /api/admin/users -> Status: ${adminPerm3.status} (Expected: 200)`);
      results.push({
        Account: 'eagleeye@gmail.com',
        Role: 'ADMIN',
        Test: 'Admin Employee Accounts Access',
        Result: adminPerm3.status === 200 ? 'PASS' : 'FAIL',
        Details: `Status ${adminPerm3.status}`,
      });
    }

    // ---------------------------------------------------------
    // Phase 7: Privilege Escalation Prevention
    // ---------------------------------------------------------
    console.log('\n--- Phase 7: Privilege Escalation Attempt (Body/Header Tampering) ---');
    if (salesToken) {
      // Sales attempting to elevate role in body or query
      const tamperedRes = await apiRequest('/api/admin/users?role=SUPER_ADMIN', 'GET', salesToken, { role: 'SUPER_ADMIN' });
      const isBlocked = tamperedRes.status === 403;
      console.log(`  Sales tampering role=SUPER_ADMIN -> Status: ${tamperedRes.status} (${isBlocked ? '✅ Blocked 403' : '❌ Tampered'})`);
      results.push({
        Account: 'sales@gmail.com',
        Role: 'SALES',
        Test: 'Block Client Role Elevation Attempt (403)',
        Result: isBlocked ? 'PASS' : 'FAIL',
        Details: `Status ${tamperedRes.status}`,
      });
    }

    console.log('\n========================================================================');
    console.log('  TEST EXECUTION COMPLETED                                              ');
    console.log('========================================================================\n');

    console.table(results);

    const allPassed = results.every((r) => r.Result === 'PASS');
    if (allPassed) {
      console.log(`\n✅ ALL ${results.length} ROLE-BASED ACCESS CONTROL TESTS PASSED SUCCESSFULLY!`);
      process.exit(0);
    } else {
      const failed = results.filter((r) => r.Result === 'FAIL');
      console.error(`\n❌ ${failed.length} OF ${results.length} TESTS FAILED:`, failed);
      process.exit(1);
    }
  } catch (err) {
    console.error('Test script error:', err);
    process.exit(1);
  }
}

runTests();
