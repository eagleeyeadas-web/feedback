import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Safe Global Frontend Fetch Timing Instrumenter (Logs URL path and duration, never logs tokens or credentials)
if (typeof window !== 'undefined' && window.fetch) {
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const t0 = performance.now();
    const rawUrl = typeof input === 'string' ? input : (input?.url || 'unknown');
    // Strip query strings to ensure no sensitive tokens or params appear in logs
    const sanitizedUrl = rawUrl.split('?')[0];
    const method = (init?.method || 'GET').toUpperCase();
    const startTimeIso = new Date().toISOString();

    console.log(`[FE_FETCH_START] ${startTimeIso} | ${method} ${sanitizedUrl}`);

    try {
      const res = await originalFetch(input, init);
      const duration = (performance.now() - t0).toFixed(2);
      console.log(`[FE_FETCH_END] ${new Date().toISOString()} | ${method} ${sanitizedUrl} | Status: ${res.status} | Duration: ${duration}ms`);
      return res;
    } catch (err) {
      const duration = (performance.now() - t0).toFixed(2);
      console.warn(`[FE_FETCH_FAIL] ${new Date().toISOString()} | ${method} ${sanitizedUrl} | Error: ${err.message} | Duration: ${duration}ms`);
      throw err;
    }
  };
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

