import http from 'http';
import express from 'express';
import inventoryRoutes from '../src/routes/inventory.js';

console.log('Testing GET /api/admin/inventory role permissions...');

function createTestServer(role) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: `mock-${role.toLowerCase()}`, email: `${role.toLowerCase()}@test.com` };
    req.profile = { role, email: `${role.toLowerCase()}@test.com` };
    next();
  });
  app.use('/api/admin/inventory', inventoryRoutes);
  return http.createServer(app);
}

async function verifyRoles() {
  const allowedRoles = ['SALES', 'TECHNICAL', 'STORE_MANAGER', 'COORDINATOR', 'HR', 'ADMIN'];
  let passed = 0;

  for (const role of allowedRoles) {
    const server = createTestServer(role);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/admin/inventory`);
      const data = await res.json();
      
      if (res.status === 200 && Array.isArray(data)) {
        console.log(`✔ [PASS] Role ${role} can successfully access GET /api/admin/inventory (Status 200, got ${data.length} products)`);
        passed++;
      } else {
        console.error(`❌ [FAIL] Role ${role} received status ${res.status}:`, data);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Test unauthorized role
  const unauthServer = createTestServer('UNAUTHORIZED_GUEST');
  await new Promise((resolve) => unauthServer.listen(0, resolve));
  const unauthPort = unauthServer.address().port;
  try {
    const unauthRes = await fetch(`http://127.0.0.1:${unauthPort}/api/admin/inventory`);
    if (unauthRes.status === 403) {
      console.log(`✔ [PASS] Unauthorized role correctly denied with 403 Forbidden`);
      passed++;
    } else {
      console.error(`❌ [FAIL] Unauthorized role expected 403 but got ${unauthRes.status}`);
    }
  } finally {
    await new Promise((resolve) => unauthServer.close(resolve));
  }

  console.log(`\nInventory Permissions Test Summary: ${passed}/${allowedRoles.length + 1} passed.\n`);
  if (passed === allowedRoles.length + 1) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

verifyRoles().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
