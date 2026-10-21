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
import bomRoutes from './routes/bom.js';
import materialRoutes from './routes/materials.js';
import coordinatorRoutes from './routes/coordinator.js';
import hrRoutes from './routes/hr.js';
import courierRoutes from './routes/courier.js';
import notificationRoutes from './routes/notifications.js';
import { runFullCleanup, handleCleanupEndpoint, handleCleanupStatusEndpoint, executeActivityTriggeredCleanup } from './services/quotationCleanupService.js';
import { startDailyCleanupSchedule } from './services/inventoryCleanupService.js';
import { startOverdueDetectionScheduler } from './services/overdueDetectionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const SERVER_STARTUP_TIMESTAMP = Date.now();
console.log(`[BACKEND_STARTUP] Node.js Process ${process.pid} initialized at ${new Date(SERVER_STARTUP_TIMESTAMP).toISOString()}`);

// Trust reverse proxy (e.g. Render, Nginx, Cloudflare) for accurate client IP rate limiting
app.set('trust proxy', 1);

// Safe Request Timing Middleware (Measures arrival time and total processing duration without logging sensitive data)
app.use((req, res, next) => {
  const reqStart = performance.now();
  const arrivalIso = new Date().toISOString();
  const uptimeSeconds = ((Date.now() - SERVER_STARTUP_TIMESTAMP) / 1000).toFixed(1);
  const method = req.method;
  const path = req.path;

  console.log(`[BACKEND_REQ_START] ${arrivalIso} | ${method} ${path} | Server Uptime: ${uptimeSeconds}s`);

  res.on('finish', () => {
    const duration = (performance.now() - reqStart).toFixed(2);
    console.log(`[BACKEND_REQ_END] ${new Date().toISOString()} | ${method} ${path} | Status: ${res.statusCode} | Duration: ${duration}ms | Server Uptime: ${uptimeSeconds}s`);
  });

  next();
});

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.cors.origin,
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-cron-secret'],
  credentials: true,
}));

// Global rate limiter with structured JSON response
app.use(rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.' },
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json(typeof options.message === 'string' ? { error: options.message } : options.message);
  },
}));

// Body parsing
app.use(express.json({ limit: '10mb' })); // Large limit for signature base64
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Centralized Cleanup Endpoints
app.post('/api/admin/cleanup', handleCleanupEndpoint);
app.get('/api/admin/cleanup/status', handleCleanupStatusEndpoint);


// Routes
app.use('/api/feedback', feedbackRoutes);
app.use('/api/admin/quotations', quotationRoutes);
app.use('/api/admin/installations', installationRoutes);
app.use('/api/installations', installationRoutes);
app.use('/api/admin/inventory', inventoryRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/admin/bom', bomRoutes);
app.use('/api/bom', bomRoutes);
app.use('/api/admin/materials', materialRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/admin/coordinator', coordinatorRoutes);
app.use('/api/coordinator', coordinatorRoutes);
app.use('/api/admin/hr', hrRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/admin/courier', courierRoutes);
app.use('/api/courier', courierRoutes);
app.use('/api/admin/customers', customerRoutes);
app.use('/api/admin/users', userRoutes);
app.use('/api/admin/audit-logs', auditRoutes);
app.use('/api/admin/notifications', notificationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);

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

  // Controlled 20-day centralized cleanup background task (Enforces 24-hour limit & atomic lock)
  const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  
  // Initial check 15 seconds after startup (safely catches up if server slept on Render)
  setTimeout(() => {
    executeActivityTriggeredCleanup({ userId: null, force: false }).catch(err => console.error('Initial startup cleanup check error:', err));
  }, 15000);

  // Set recurring schedule (controlled with 24h database state verification)
  setInterval(() => {
    executeActivityTriggeredCleanup({ userId: null, force: false }).catch(err => console.error('Scheduled daily cleanup check error:', err));
  }, CLEANUP_INTERVAL_MS);

  // Automatic 20-day inventory and returns history retention cleanup
  startDailyCleanupSchedule();

  // Automatic 24/7 overdue detection and idempotent HR alerting scheduler
  startOverdueDetectionScheduler();
});

export default app;
