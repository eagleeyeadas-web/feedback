import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from './config.js';
import feedbackRoutes from './routes/feedback.js';
import adminRoutes from './routes/admin.js';
import quotationRoutes from './routes/quotation.js';
import installationRoutes from './routes/installation.js';
import inventoryRoutes from './routes/inventory.js';
import customerRoutes from './routes/customers.js';
import userRoutes from './routes/users.js';
import auditRoutes from './routes/audit.js';
import { runQuotationCleanup } from './services/quotationCleanupService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.cors.origin,
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-cron-secret'],
  credentials: true,
}));

// Global rate limiter
app.use(rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Body parsing
app.use(express.json({ limit: '10mb' })); // Large limit for signature base64
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/feedback', feedbackRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/quotations', quotationRoutes);
app.use('/api/admin/quotation', quotationRoutes);
app.use('/api/admin/installations', installationRoutes);
app.use('/api/installations', installationRoutes);
app.use('/api/admin/inventory', inventoryRoutes);
app.use('/api/admin/customers', customerRoutes);
app.use('/api/admin/users', userRoutes);
app.use('/api/admin/audit-logs', auditRoutes);

// Serve built static frontend files if present (fixes 404 on refresh)
const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

// 404 handler for API routes or unhandled requests
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
// Bind to 0.0.0.0 so Render (and other cloud hosts) can reach the server.
// Locally, this still works on localhost:3001.
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Eagle Eye Feedback API running on port ${config.port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Automated 10-day quotation cleanup background task (Runs every 6 hours)
  const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
  
  // Initial check 10 seconds after startup
  setTimeout(() => {
    runQuotationCleanup().catch(err => console.error('Initial startup quotation cleanup error:', err));
  }, 10000);

  // Set recurring schedule
  setInterval(() => {
    runQuotationCleanup().catch(err => console.error('Scheduled quotation cleanup error:', err));
  }, CLEANUP_INTERVAL_MS);
});

export default app;
