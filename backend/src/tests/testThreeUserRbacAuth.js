import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { requireAuth, requireRole, requireAdmin } from '../middleware/auth.js';
import supabase from '../services/supabase.js';

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function runTests() {
  console.log('========================================================');
  console.log('RUNNING SAFDRIVE THREE-USER AUTH & RBAC TEST SUITE');
  console.log('========================================================\n');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  assert(supabaseUrl, 'SUPABASE_URL must be configured');
  assert(serviceKey, 'SUPABASE_SERVICE_ROLE_KEY must be configured');

  const authClient = createClient(supabaseUrl, serviceKey);

  // Define credentials for the three accounts from environment variables
  const salesCreds = { email: 'sales@gmail.com', pass: process.env.SALES_ACCOUNT_PASSWORD, expectedRole: 'SALES' };
  const techCreds = { email: 'tech@gmail.com', pass: process.env.TECH_ACCOUNT_PASSWORD, expectedRole: 'TECHNICAL' };
  const storeCreds = { email: 'store@gmail.com', pass: process.env.STORE_ACCOUNT_PASSWORD, expectedRole: 'STORE_MANAGER' };

  let salesToken = null;
  let techToken = null;
  let storeToken = null;

  // --------------------------------------------------------------------------
  // TEST GROUP 1: Supabase Auth Login Verification
  // --------------------------------------------------------------------------
  console.log('[Test Group 1] Supabase Auth Credentials & Sign In');

  await itAsync('Account 1 (Sales: sales@gmail.com) authenticates successfully with environment credentials', async () => {
    if (!salesCreds.pass) {
      console.log('    ⚠️ Skipped: SALES_ACCOUNT_PASSWORD not set in environment');
      return;
    }
    const { data, error } = await authClient.auth.signInWithPassword({
      email: salesCreds.email,
      password: salesCreds.pass,
    });
    assert.ifError(error);
    assert(data.session && data.session.access_token, 'Session token should be present');
    assert.strictEqual(data.user.email.toLowerCase(), salesCreds.email);
    salesToken = data.session.access_token;
  });

  await itAsync('Account 2 (Technical: tech@gmail.com) authenticates successfully with environment credentials', async () => {
    if (!techCreds.pass) {
      console.log('    ⚠️ Skipped: TECH_ACCOUNT_PASSWORD not set in environment');
      return;
    }
    const { data, error } = await authClient.auth.signInWithPassword({
      email: techCreds.email,
      password: techCreds.pass,
    });
    assert.ifError(error);
    assert(data.session && data.session.access_token, 'Session token should be present');
    assert.strictEqual(data.user.email.toLowerCase(), techCreds.email);
    techToken = data.session.access_token;
  });

  await itAsync('Account 3 (Store Manager: store@gmail.com) authenticates successfully with environment credentials', async () => {
    if (!storeCreds.pass) {
      console.log('    ⚠️ Skipped: STORE_ACCOUNT_PASSWORD not set in environment');
      return;
    }
    const { data, error } = await authClient.auth.signInWithPassword({
      email: storeCreds.email,
      password: storeCreds.pass,
    });
    assert.ifError(error);
    assert(data.session && data.session.access_token, 'Session token should be present');
    assert.strictEqual(data.user.email.toLowerCase(), storeCreds.email);
    storeToken = data.session.access_token;
  });

  await itAsync('Incorrect password for sales@gmail.com is strictly rejected', async () => {
    const { data, error } = await authClient.auth.signInWithPassword({
      email: salesCreds.email,
      password: 'wrong_password_123',
    });
    assert(error, 'Error should be returned for incorrect password');
    assert.strictEqual(data.session, null);
  });

  await itAsync('Incorrect password for tech@gmail.com is strictly rejected', async () => {
    const { data, error } = await authClient.auth.signInWithPassword({
      email: techCreds.email,
      password: 'wrong_password_123',
    });
    assert(error, 'Error should be returned for incorrect password');
    assert.strictEqual(data.session, null);
  });

  await itAsync('Incorrect password for store@gmail.com is strictly rejected', async () => {
    const { data, error } = await authClient.auth.signInWithPassword({
      email: storeCreds.email,
      password: 'wrong_password_123',
    });
    assert(error, 'Error should be returned for incorrect password');
    assert.strictEqual(data.session, null);
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 2: Express Server-Side RBAC Middleware Verification
  // --------------------------------------------------------------------------
  console.log('\n[Test Group 2] Express Middleware Role-Based Access Control');

  // Spin up an in-process Express app to test actual HTTP requests
  const testApp = express();
  testApp.use(express.json());

  // Test endpoints
  testApp.get('/test/me', requireAuth, (req, res) => {
    res.json({ email: req.user.email, role: req.profile?.role });
  });

  testApp.get('/test/sales-only', requireRole('SALES'), (req, res) => {
    res.json({ message: 'Welcome Sales' });
  });

  testApp.get('/test/tech-only', requireRole('TECHNICAL'), (req, res) => {
    res.json({ message: 'Welcome Technical' });
  });

  testApp.get('/test/store-only', requireRole('STORE_MANAGER'), (req, res) => {
    res.json({ message: 'Welcome Store Manager' });
  });

  testApp.get('/test/admin-only', requireAdmin, (req, res) => {
    res.json({ message: 'Welcome Admin' });
  });

  const server = http.createServer(testApp);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function makeRequest(path, token) {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${path}`, { headers });
    const json = await res.json().catch(() => null);
    return { status: res.status, data: json };
  }

  // 1. Unauthenticated checks
  await itAsync('Unauthenticated request to /test/me returns 401 Unauthorized', async () => {
    const res = await makeRequest('/test/me');
    assert.strictEqual(res.status, 401);
  });

  await itAsync('Invalid Bearer token returns 401 Unauthorized', async () => {
    const res = await makeRequest('/test/me', 'invalid_fake_token_xyz');
    assert.strictEqual(res.status, 401);
  });

  // 2. Sales role checks
  await itAsync('Sales token resolves trusted role "SALES"', async () => {
    const res = await makeRequest('/test/me', salesToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.role, 'SALES');
    assert.strictEqual(res.data.email.toLowerCase(), 'sales@gmail.com');
  });

  await itAsync('Sales can access /test/sales-only (200 OK)', async () => {
    const res = await makeRequest('/test/sales-only', salesToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, 'Welcome Sales');
  });

  await itAsync('Sales CANNOT access /test/tech-only (403 Forbidden)', async () => {
    const res = await makeRequest('/test/tech-only', salesToken);
    assert.strictEqual(res.status, 403);
    assert(res.data.error.includes('Access denied'));
  });

  await itAsync('Sales CANNOT access /test/store-only (403 Forbidden)', async () => {
    const res = await makeRequest('/test/store-only', salesToken);
    assert.strictEqual(res.status, 403);
    assert(res.data.error.includes('Access denied'));
  });

  // 3. Technical role checks
  await itAsync('Technical token resolves trusted role "TECHNICAL"', async () => {
    const res = await makeRequest('/test/me', techToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.role, 'TECHNICAL');
    assert.strictEqual(res.data.email.toLowerCase(), 'tech@gmail.com');
  });

  await itAsync('Technical can access /test/tech-only (200 OK)', async () => {
    const res = await makeRequest('/test/tech-only', techToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, 'Welcome Technical');
  });

  await itAsync('Technical CANNOT access /test/sales-only (403 Forbidden)', async () => {
    const res = await makeRequest('/test/sales-only', techToken);
    assert.strictEqual(res.status, 403);
    assert(res.data.error.includes('Access denied'));
  });

  await itAsync('Technical CANNOT access /test/store-only (403 Forbidden)', async () => {
    const res = await makeRequest('/test/store-only', techToken);
    assert.strictEqual(res.status, 403);
    assert(res.data.error.includes('Access denied'));
  });

  // 4. Store Manager role checks
  await itAsync('Store Manager token resolves trusted role "STORE_MANAGER"', async () => {
    const res = await makeRequest('/test/me', storeToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.role, 'STORE_MANAGER');
    assert.strictEqual(res.data.email.toLowerCase(), 'store@gmail.com');
  });

  await itAsync('Store Manager can access /test/store-only (200 OK)', async () => {
    const res = await makeRequest('/test/store-only', storeToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.message, 'Welcome Store Manager');
  });

  await itAsync('Store Manager CANNOT access /test/sales-only (403 Forbidden)', async () => {
    const res = await makeRequest('/test/sales-only', storeToken);
    assert.strictEqual(res.status, 403);
    assert(res.data.error.includes('Access denied'));
  });

  await itAsync('Store Manager CANNOT access /test/tech-only (403 Forbidden)', async () => {
    const res = await makeRequest('/test/tech-only', storeToken);
    assert.strictEqual(res.status, 403);
    assert(res.data.error.includes('Access denied'));
  });

  // 5. Cross-department isolation (No universal super-admin bypass)
  await itAsync('Store Manager CANNOT access admin-only endpoints without ADMIN role (403 Forbidden)', async () => {
    const res = await makeRequest('/test/admin-only', storeToken);
    assert.strictEqual(res.status, 403);
  });

  await itAsync('Technical CANNOT access admin-only endpoints without ADMIN role (403 Forbidden)', async () => {
    const res = await makeRequest('/test/admin-only', techToken);
    assert.strictEqual(res.status, 403);
  });

  await itAsync('Sales CANNOT access admin-only endpoints without ADMIN role (403 Forbidden)', async () => {
    const res = await makeRequest('/test/admin-only', salesToken);
    assert.strictEqual(res.status, 403);
  });

  server.close();

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n========================================================');
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('========================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
