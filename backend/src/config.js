import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });


const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX || '2500', 10), // max requests per window (increased from 100 for normal operational usage)
    feedbackMax: 20, // max feedback submissions per window
  },

  timezone: 'Asia/Kolkata',

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || 'BHuQF3JPfy22S-XKWMTxF6Ay6bg0nV-7dKX28lN8ZXS_zqOoaNPDtypy7-K_e4JDgu8xxF43TgrQ9o48BHZIeT0',
    privateKey: process.env.VAPID_PRIVATE_KEY || 'fXVuY6eOqDiXYaxRjcFc1ADUQ70mxn48IZOa-9d50UY',
    subject: process.env.VAPID_SUBJECT || 'mailto:support@eagleeyesafdrive.com',
  },
};

// Validate required config
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

export default config;
