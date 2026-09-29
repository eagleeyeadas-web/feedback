import { createClient } from '@supabase/supabase-js';
import config from '../config.js';

// Service role client - has full access, used only on backend
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export default supabase;
