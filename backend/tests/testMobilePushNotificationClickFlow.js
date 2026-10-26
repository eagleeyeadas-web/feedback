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
import sharp from 'sharp';
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
    return { isKnownSafDrivePath, buildHashUrl, resolveNotificationUrl, resolveNotificationAssetUrl, APP_ORIGIN };
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
    assert.strictEqual(res.payload.icon, `${getNotificationBaseUrl()}/icon-192.png`, 'Push payload icon must be absolute URL to icon-192.png');
    assert.strictEqual(res.payload.badge, `${getNotificationBaseUrl()}/badge-96.png`, 'Push payload badge must be absolute URL to transparent monochrome badge-96.png');

    const expectedAbsolute = `${getNotificationBaseUrl()}/#/admin/installation-checklists/${mockChecklist.id}`;
    const resolvedInSw = sw.resolveNotificationUrl(expectedAbsolute);
    assert.strictEqual(resolvedInSw, `${testOrigin}/#/admin/installation-checklists/${mockChecklist.id}`);
    pass('Checklist created notification payload contains verified absolute link matching HashRouter, icon-192, and badge-96');
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
    assert.strictEqual(coordRes.payload.icon, `${getNotificationBaseUrl()}/icon-192.png`, 'Coordinator push payload icon must be absolute URL');
    assert.strictEqual(coordRes.payload.badge, `${getNotificationBaseUrl()}/badge-96.png`, 'Coordinator push payload badge must be absolute URL');

    const expectedCoordRel = `/coordinator?view=${coordChecklistId}&checklist=${coordChecklistId}&tab=return&openReport=true`;
    const resolvedCoord = sw.resolveNotificationUrl(expectedCoordRel);
    assert.strictEqual(
      resolvedCoord,
      `${testOrigin}/#/coordinator?view=${coordChecklistId}&checklist=${coordChecklistId}&tab=return&openReport=true`
    );
    pass('Coordinator deep link includes checklist ID, tab, and openReport parameters with absolute icon and badge');
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
    assert(!rewriteRegex.test('/badge-96.png'), 'Rewrite must NOT match /badge-96.png');
    assert(!rewriteRegex.test('/badge.png'), 'Rewrite must NOT match /badge.png');
    assert(!rewriteRegex.test('/logo.png'), 'Rewrite must NOT match /logo.png');
    assert(!rewriteRegex.test('/assets/index.js'), 'Rewrite must NOT match /assets/*');
    assert(!rewriteRegex.test('/api/health'), 'Rewrite must NOT match /api/*');

    pass('Vercel SPA rewrite rules protect static assets, icons, badges, and sw.js while rewriting SPA routes');
  } catch (err) {
    fail('Vercel rewrites configuration failed', err);
  }

  // ------------------------------------------------------------------
  // 8. PUSH NOTIFICATION ASSETS & ANDROID MONOCHROME BADGE INTEGRITY
  // ------------------------------------------------------------------
  try {
    console.log('-> 8. Verifying Push Notification Assets & Android Badge Mask Integrity...');
    const publicDir = path.resolve(__dirname, '../../frontend/public');
    const distDir = path.resolve(__dirname, '../../frontend/dist');

    const requiredAssets = [
      'badge-96.png',
      'badge-72.png',
      'badge-48.png',
      'badge.png',
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-192.png',
      'icon-maskable-512.png',
      'logo.png',
      'manifest.json',
      'sw.js',
    ];

    for (const asset of requiredAssets) {
      assert(fs.existsSync(path.join(publicDir, asset)), `frontend/public/${asset} must exist`);
      assert(fs.existsSync(path.join(distDir, asset)), `frontend/dist/${asset} must exist in build distribution`);
    }

    // Inspect badge-96.png with Sharp
    const badge96Path = path.join(publicDir, 'badge-96.png');
    const badgeMeta = await sharp(badge96Path).metadata();
    assert.strictEqual(badgeMeta.width, 96, 'badge-96 width must be 96');
    assert.strictEqual(badgeMeta.height, 96, 'badge-96 height must be 96');
    assert.strictEqual(badgeMeta.channels, 4, 'badge-96 must have 4 channels (RGBA with alpha mask)');
    assert(badgeMeta.hasAlpha, 'badge-96 must have an alpha channel for transparency');

    // Inspect badge pixels to ensure monochrome silhouette on transparent background
    const badgeRaw = await sharp(badge96Path).raw().toBuffer();
    let transparentPixels = 0;
    let solidWhitePixels = 0;
    for (let i = 0; i < badgeRaw.length; i += 4) {
      const r = badgeRaw[i];
      const g = badgeRaw[i + 1];
      const b = badgeRaw[i + 2];
      const a = badgeRaw[i + 3];
      if (a === 0) {
        transparentPixels++;
      } else if (a > 0) {
        // Pixel should be pure white tint for Android stencil mask
        assert.strictEqual(r, 255, 'Badge visible pixels must be pure white (R=255)');
        assert.strictEqual(g, 255, 'Badge visible pixels must be pure white (G=255)');
        assert.strictEqual(b, 255, 'Badge visible pixels must be pure white (B=255)');
        solidWhitePixels++;
      }
    }
    assert(transparentPixels > 0, 'Badge must have transparent pixels around the logo emblem');
    assert(solidWhitePixels > 0, 'Badge must have solid white pixels for the logo emblem');

    // Inspect icon-192.png with Sharp (large icon in full color)
    const icon192Path = path.join(publicDir, 'icon-192.png');
    const iconMeta = await sharp(icon192Path).metadata();
    assert.strictEqual(iconMeta.width, 192, 'icon-192 width must be 192');
    assert.strictEqual(iconMeta.height, 192, 'icon-192 height must be 192');
    assert(iconMeta.hasAlpha, 'icon-192 must support transparency');

    // Test Service Worker resolveNotificationAssetUrl behavior
    const asset1 = sw.resolveNotificationAssetUrl('/icon-192.png', '/icon-192.png');
    assert.strictEqual(asset1, `${testOrigin}/icon-192.png`);

    const asset2 = sw.resolveNotificationAssetUrl('/badge-96.png', '/badge-96.png');
    assert.strictEqual(asset2, `${testOrigin}/badge-96.png`);

    const asset3 = sw.resolveNotificationAssetUrl(null, '/badge-96.png');
    assert.strictEqual(asset3, `${testOrigin}/badge-96.png`);

    const asset4 = sw.resolveNotificationAssetUrl('https://eagleeyesafdrive.vercel.app/icon-192.png', '/icon-192.png');
    assert.strictEqual(asset4, 'https://eagleeyesafdrive.vercel.app/icon-192.png');

    pass('Push notification assets, monochrome alpha mask badge, and SW asset URL resolution verified successfully');
  } catch (err) {
    fail('Push notification assets integrity check failed', err);
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
