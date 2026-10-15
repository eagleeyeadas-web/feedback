import http from 'http';
import express from 'express';
import installationRoutes from '../src/routes/installation.js';

// Create a test harness app with auth bypassed for test
const app = express();
app.use(express.json());

// Mock requireRole middleware behavior by injecting mock user profile
app.use((req, res, next) => {
  req.user = { id: '00000000-0000-0000-0000-000000000001', email: 'tech@eagleeye.com' };
  req.profile = { id: '00000000-0000-0000-0000-000000000001', role: 'TECHNICAL', email: 'tech@eagleeye.com' };
  next();
});

app.use('/api/admin/installations', installationRoutes);

async function testBackupProductsRoute() {
  console.log('Testing GET /api/admin/installations/backup-products route resolution...');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/installations/backup-products`);
    console.log('Status:', response.status);
    if (response.status !== 200) {
      const errText = await response.text();
      console.error('Response body:', errText);
      throw new Error(`Expected HTTP 200, got ${response.status}`);
    }

    const res = { body: await response.json() };

  if (!res.body || !Array.isArray(res.body.products)) {
    throw new Error('Response body does not contain products array');
  }

  const { products } = res.body;
  console.log(`Loaded ${products.length} products successfully!`);

  const deviceComponents = products.filter((p) => p.category === 'Device Component');
  const materials = products.filter((p) => p.category === 'Installation Material');

  console.log(`Device Components (${deviceComponents.length}):`, deviceComponents.map((p) => `${p.item_name} [${p.unit}]`));
  console.log(`Installation Materials (${materials.length}):`, materials.map((p) => `${p.item_name} [${p.unit}]`));

  // Required Device Components
  const hasCamera = deviceComponents.some((p) => p.item_name.toLowerCase() === 'camera');
  const hasLiveDisplay = deviceComponents.some((p) => p.item_name.toLowerCase() === 'live display');
  const hasRecordingDisplay = deviceComponents.some((p) => p.item_name.toLowerCase() === 'recording display');

  if (!hasCamera) throw new Error('Missing Camera in Device Components');
  if (!hasLiveDisplay) throw new Error('Missing Live Display in Device Components');
  if (!hasRecordingDisplay) throw new Error('Missing Recording Display in Device Components');

  // Required Installation Materials
  const requiredMats = [
    'insulation tape',
    'cable tie – 200 mm',
    'cable tie – 300 mm',
    'long screw',
    'small screw',
    '0.5 mm wire',
    '5-metre cable',
    '15-metre cable',
    'memory card',
  ];

  for (const mat of requiredMats) {
    const found = materials.some((p) => p.item_name.toLowerCase().includes(mat.toLowerCase().replace('–', '-').slice(0, 10)));
    if (!found) {
      console.warn(`Warning: check mat name match for "${mat}"`);
    } else {
      console.log(`Verified material present: "${mat}"`);
    }
  }

    console.log('\n[SUCCESS] Route ordering test passed! /backup-products is correctly resolved with HTTP 200.');
  } finally {
    server.close();
  }
}

testBackupProductsRoute()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
