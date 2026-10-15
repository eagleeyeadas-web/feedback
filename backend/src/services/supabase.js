import { createClient } from '@supabase/supabase-js';
import config from '../config.js';

// Service role client - has full access, used only on backend
const rawSupabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

function instrumentBuilder(builder, tableName) {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (prop === 'then') {
        return function(onFulfilled, onRejected) {
          const start = performance.now();
          const startIso = new Date().toISOString();
          console.log(`[SUPABASE_QUERY_START] ${startIso} | Table: ${tableName}`);
          return val.call(target, (res) => {
            const dur = (performance.now() - start).toFixed(2);
            const count = Array.isArray(res?.data) ? res.data.length : (res?.data ? 1 : 0);
            console.log(`[SUPABASE_QUERY_END] ${new Date().toISOString()} | Table: ${tableName} | Status: ${res?.error ? 'ERROR: ' + res.error.message : 'OK (' + count + ' rows)'} | Duration: ${dur}ms`);
            return onFulfilled ? onFulfilled(res) : res;
          }, (err) => {
            const dur = (performance.now() - start).toFixed(2);
            console.log(`[SUPABASE_QUERY_FAIL] ${new Date().toISOString()} | Table: ${tableName} | Error: ${err.message} | Duration: ${dur}ms`);
            return onRejected ? onRejected(err) : Promise.reject(err);
          });
        };
      }
      if (typeof val === 'function') {
        return function(...args) {
          const ret = val.apply(target, args);
          if (ret && typeof ret === 'object') {
            return instrumentBuilder(ret, tableName);
          }
          return ret;
        };
      }
      return val;
    }
  });
}

// Safe Query Timing Proxy (Does NOT log sensitive query parameters, passwords, or tokens)
const supabase = new Proxy(rawSupabase, {
  get(target, prop) {
    if (prop === 'from') {
      return (tableName) => instrumentBuilder(target.from(tableName), tableName);
    }
    return target[prop];
  },
});

export default supabase;
