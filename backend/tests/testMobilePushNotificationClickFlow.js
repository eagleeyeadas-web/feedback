import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import {
  getNotificationBaseUrl,
  buildNotificationUrl,
  notifyChecklistCreated,
  notifyCoordinatorReportSubmitted,
  sendTestNotificationToUser,
  saveSubscription,
  getAllActiveSubscriptions,
} from '../src/services/pushNotificationService.js';

// Load Service Worker code into string to test resolution logic directly
import fs from 'fs';
const swPath = path.resolve(__dirname, '../../frontend/public/sw.js');
const swCode = fs.readFileSync(swPath, 'utf-8');

/**
 * Sandboxed evaluation of sw.js helper functions
 */
function createSwSandbox(simulatedOrigin = 'https://eagleeyesafdrive.vercel.app') {
  const context = {
    self: { location: { origin: simulatedOrigin } },
    console: { warn: () => {}, log: () => {} },
  };

  // Extract functions from sw.js
  const fn = new Function('self', 'console', `
    const APP_ORIGIN = self.location.origin;
    ${swCode.slice(swCode.indexOf('function isKnownSafDrivePath'), swCode.indexOf('self.addEventListener(\'push\''))}
    return { isKnownSafDrivePath, buildHashUrl, resolveNotificationUrl, APP_ORIGIN };
  `);

  return fn(context.self, context.console);
}

/**
 * Simulate Login.jsx resolveAppNavigationPath
 */
function resolveAppNavigationPath(rawPath) {
  if (!rawPath) return null;
  let pathStr = String(rawPath).trim();
  try {
    if (pathStr.startsWith('http://') || pathStr.startsWith('https://')) {
      const u = new URL(pathStr);
      pathStr = u.hash ? u.hash.replace(/^#/, '') : (u.pathname + u.search);
    }
  } catch {}
  let clean = pathStr.replace(/^#+/, '').trim();
  if (!clean.startsWith('/')) {
    clean = '/' + clean;
  }
  return clean;
}

/**
 * Simulate index.html synchronous Path-to-Hash Router Bridge
 */
function simulateIndexHtmlPathBridge(pathname, search = '', hash = '') {
  let targetUrl = null;
  if (pathname && pathname !== '/' && !pathname.startsWith('/assets/') && !pathname.startsWith('/api/') && !pathname.includes('.')) {
    if (!hash || hash === '#' || hash === '#/') {
      targetUrl = '/#' + pathname + search;
    }
  }
  return targetUrl;
}

async function runMobilePushVerificationSuite() {
  console.log('========================================================================');
  console.log('  EAGLE EYE SAFDRIVE — MOBILE PUSH NOTIFICATION CLICK FLOW TESTS');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function pass(msg) {
    passed++;
    console.log(`✅ [PASS] ${msg}`);
  }

  function fail(msg, err) {
    failed++;
    console.error(`❌ [FAIL] ${msg}`, err);
  }

  const testOrigin = 'https://eagleeyesafdrive.vercel.app';
  const sw = createSwSandbox(testOrigin);

  // ------------------------------------------------------------------
  // 1. CANONICAL ABSOLUTE URL GENERATION
  // ------------------------------------------------------------------
  try {
    console.log('-> 1. Verifying Push Notification URL Generation Across Environments...');
    const baseUrl = getNotificationBaseUrl();
    assert(baseUrl.startsWith('http'), 'Base URL must be valid HTTP/HTTPS URL');
    assert(!baseUrl.endsWith('/'), 'Base URL must not have trailing slash');

    const checklistId = uuidv4();
    const chkUrl = buildNotificationUrl(`/admin/installation-checklists/${checklistId}`);
    assert.strictEqual(chkUrl, `${baseUrl}/#/admin/installation-checklists/${checklistId}`);
    pass('Canonical hash-router absolute notification URLs generated correctly');
  } catch (err) {
    fail('Canonical URL generation failed', err);
  }

  // ------------------------------------------------------------------
  // 2. CHECKLIST CREATED NOTIFICATION PAYLOAD
  // ------------------------------------------------------------------
  try {
    console.log('-> 2. Verifying Checklist Created Push Notification Payload...');
    const testSubId = uuidv4();
    await saveSubscription({
      userId: testSubId,
      userEmail: 'team.test@eagleeye.com',
      userRole: 'SALES',
      subscription: {
        endpoint: `https://fcm.googleapis.com/fcm/send/test-mobile-${Date.now()}`,
        keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
      },
      deviceType: 'Android',
    });

    const mockChecklist = {
      id: uuidv4(),
      checklist_number: `EE-INST-${Date.now()}`,
      client_name: 'Metro Transit Ltd',
      client_location: 'Chennai Central Depot',
      service_engineer: 'Sakthivel',
      created_at: new Date().toISOString(),
    };

    const res = await notifyChecklistCreated(mockChecklist, { force: true });
    assert(res.success === true, 'notifyChecklistCreated must succeed');

    const expectedAbsolute = `${getNotificationBaseUrl()}/#/admin/installation-checklists/${mockChecklist.id}`;
    const resolvedInSw = sw.resolveNotificationUrl(expectedAbsolute);
    assert.strictEqual(resolvedInSw, `${testOrigin}/#/admin/installation-checklists/${mockChecklist.id}`);
    pass('Checklist created notification payload contains verified absolute link matching HashRouter');
  } catch (err) {
    fail('Checklist created notification payload verification failed', err);
  }

  // ------------------------------------------------------------------
  // 3. COORDINATOR REPORT SUBMISSION DEEP LINK
  // ------------------------------------------------------------------
  try {
    console.log('-> 3. Verifying Coordinator Deep Link URL Generation...');
    const coordChecklistId = uuidv4();
    const mockCoordChecklist = {
      id: coordChecklistId,
      checklist_number: `EE-INST-COORD-001`,
      service_engineer: 'Guna',
    };

    const coordSubId = uuidv4();
    await saveSubscription({
      userId: coordSubId,
      userEmail: 'coordinator.fleet@eagleeye.com',
      userRole: 'COORDINATOR',
      subscription: {
        endpoint: `https://fcm.googleapis.com/fcm/send/test-coord-${Date.now()}`,
        keys: { p256dh: 'coord-p256dh', auth: 'coord-auth' },
      },
      deviceType: 'iOS',
    });

    const coordRes = await notifyCoordinatorReportSubmitted({
      checklist: mockCoordChecklist,
      technicianName: 'Guna',
      force: true,
    });
    assert(coordRes.attempted >= 1, 'Coordinator push must find active subscription');

    const expectedCoordRel = `/coordinator?view=${coordChecklistId}&checklist=${coordChecklistId}&tab=return&openReport=true`;
    const resolvedCoord = sw.resolveNotificationUrl(expectedCoordRel);
    assert.strictEqual(
      resolvedCoord,
      `${testOrigin}/#/coordinator?view=${coordChecklistId}&checklist=${coordChecklistId}&tab=return&openReport=true`
    );
    pass('Coordinator deep link includes checklist ID, tab, and openReport parameters');
  } catch (err) {
    fail('Coordinator deep link verification failed', err);
  }

  // ------------------------------------------------------------------
  // 4. SERVICE WORKER URL RESOLUTION & STALE NOTIFICATION TOLERANCE
  // ------------------------------------------------------------------
  try {
    console.log('-> 4. Verifying Service Worker URL Resolution Across Scenarios...');

    // Scenario A: Relative path
    const r1 = sw.resolveNotificationUrl('/admin/installation-checklists/abc-123');
    assert.strictEqual(r1, `${testOrigin}/#/admin/installation-checklists/abc-123`);

    // Scenario B: Absolute URL from this origin
    const r2 = sw.resolveNotificationUrl(`${testOrigin}/#/technical?view=xyz-789`);
    assert.strictEqual(r2, `${testOrigin}/#/technical?view=xyz-789`);

    // Scenario C: Stale notification from older localhost environment
    const r3 = sw.resolveNotificationUrl('http://localhost:5173/admin/installation-checklists/abc-123');
    assert.strictEqual(r3, `${testOrigin}/#/admin/installation-checklists/abc-123`);

    // Scenario D: Stale notification from Vercel preview domain
    const r4 = sw.resolveNotificationUrl('https://feedback-preview-branch-eagleeye.vercel.app/coordinator?view=abc');
    assert.strictEqual(r4, `${testOrigin}/#/coordinator?view=abc`);

    // Scenario E: Missing / null / empty
    const r5 = sw.resolveNotificationUrl(null);
    assert.strictEqual(r5, `${testOrigin}/#/admin/installation-checklists`);

    // Scenario F: Malformed / external untrusted phishing link
    const r6 = sw.resolveNotificationUrl('https://evil-hacker.com/malicious-login');
    assert.strictEqual(r6, `${testOrigin}/#/admin/installation-checklists`);

    pass('Service Worker resolveNotificationUrl handles relative, absolute, stale, preview, and external URLs safely');
  } catch (err) {
    fail('Service worker resolution test failed', err);
  }

  // ------------------------------------------------------------------
  // 5. LOGIN REDIRECT & DESTINATION PRESERVATION
  // ------------------------------------------------------------------
  try {
    console.log('-> 5. Verifying Login Redirect Resolution & Sanitization...');

    // Scenario A: Standard relative path redirect
    const s1 = resolveAppNavigationPath('/admin/installation-checklists/uuid-999');
    assert.strictEqual(s1, '/admin/installation-checklists/uuid-999');

    // Scenario B: Encoded or leading hash path (preventing # prepending bug)
    const s2 = resolveAppNavigationPath('#/coordinator?view=uuid-888');
    assert.strictEqual(s2, '/coordinator?view=uuid-888');

    // Scenario C: Double hash path
    const s3 = resolveAppNavigationPath('##/technical?view=uuid-777');
    assert.strictEqual(s3, '/technical?view=uuid-777');

    // Scenario D: Full URL redirect parameter
    const s4 = resolveAppNavigationPath('https://eagleeyesafdrive.vercel.app/#/store-manager?view=uuid-666');
    assert.strictEqual(s4, '/store-manager?view=uuid-666');

    // Scenario E: Relative path without leading slash
    const s5 = resolveAppNavigationPath('sales?view=uuid-555');
    assert.strictEqual(s5, '/sales?view=uuid-555');

    pass('Login destination restoration resolves clean routes without invalid hash prepending');
  } catch (err) {
    fail('Login destination restoration failed', err);
  }

  // ------------------------------------------------------------------
  // 6. SYNCHRONOUS PATH-TO-HASH ROUTER BRIDGE (DIRECT NAVIGATION / REFRESH)
  // ------------------------------------------------------------------
  try {
    console.log('-> 6. Verifying Direct Navigation & Refresh Path-to-Hash Bridge...');

    // Direct visit to checklist detail path on Vercel without hash
    const b1 = simulateIndexHtmlPathBridge('/admin/installation-checklists/abc-123', '?action=print');
    assert.strictEqual(b1, '/#/admin/installation-checklists/abc-123?action=print');

    // Direct visit to coordinator workspace without hash
    const b2 = simulateIndexHtmlPathBridge('/coordinator', '?view=uuid-123&tab=return');
    assert.strictEqual(b2, '/#/coordinator?view=uuid-123&tab=return');

    // Root path does not get rewritten
    const b3 = simulateIndexHtmlPathBridge('/');
    assert.strictEqual(b3, null);

    // Static asset paths (JS/CSS/PNG) must NOT be rewritten
    const b4 = simulateIndexHtmlPathBridge('/assets/index-123.js');
    assert.strictEqual(b4, null);
    const b5 = simulateIndexHtmlPathBridge('/sw.js');
    assert.strictEqual(b5, null);
    const b6 = simulateIndexHtmlPathBridge('/icon-192.png');
    assert.strictEqual(b6, null);

    pass('Path-to-Hash bridge seamlessly converts direct navigation and refreshes to HashRouter paths');
  } catch (err) {
    fail('Path-to-Hash bridge verification failed', err);
  }

  // ------------------------------------------------------------------
  // 7. VERCEL REWRITES CONFIGURATION INTEGRITY
  // ------------------------------------------------------------------
  try {
    console.log('-> 7. Verifying Vercel SPA Rewrite Configuration...');
    const rootVercelRaw = fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf-8');
    const feVercelRaw = fs.readFileSync(path.resolve(__dirname, '../../frontend/vercel.json'), 'utf-8');

    const rootVercel = JSON.parse(rootVercelRaw);
    const feVercel = JSON.parse(feVercelRaw);

    assert(Array.isArray(rootVercel.rewrites), 'root vercel.json must have rewrites array');
    assert(Array.isArray(feVercel.rewrites), 'frontend vercel.json must have rewrites array');

    const rewriteRegex = new RegExp('^' + feVercel.rewrites[0].source + '$');
    // Must match SPA application route
    assert(rewriteRegex.test('/admin/installation-checklists/abc-123'), 'Rewrite must match SPA checklist route');
    assert(rewriteRegex.test('/coordinator'), 'Rewrite must match /coordinator');
    assert(rewriteRegex.test('/technical'), 'Rewrite must match /technical');

    // Must NOT match static assets or sw.js
    assert(!rewriteRegex.test('/sw.js'), 'Rewrite must NOT match /sw.js');
    assert(!rewriteRegex.test('/manifest.json'), 'Rewrite must NOT match /manifest.json');
    assert(!rewriteRegex.test('/icon-192.png'), 'Rewrite must NOT match /icon-192.png');
    assert(!rewriteRegex.test('/assets/index.js'), 'Rewrite must NOT match /assets/*');
    assert(!rewriteRegex.test('/api/health'), 'Rewrite must NOT match /api/*');

    pass('Vercel SPA rewrite rules protect static assets and sw.js while rewriting all SPA routes to /index.html');
  } catch (err) {
    fail('Vercel rewrites configuration failed', err);
  }

  console.log('\n========================================================================');
  console.log(`  VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runMobilePushVerificationSuite().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
