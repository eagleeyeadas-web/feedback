import supabase from '../services/supabase.js';

// Fast in-memory token validation cache (60s TTL) to eliminate repeated 500-750ms Supabase round-trips
const authCache = new Map();
const AUTH_CACHE_TTL_MS = 60 * 1000;

// Periodic cleanup of expired cache entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of authCache.entries()) {
    if (entry.expiresAt <= now) {
      authCache.delete(token);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Middleware to verify Supabase JWT token and attach authenticated profile with role
 */
export async function requireAuth(req, res, next) {
  try {
    if (req.user && req.profile) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];

    // Check fast cache
    const cached = authCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      req.user = cached.user;
      req.adminUser = cached.adminUser;
      req.profile = cached.profile;
      return next();
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      authCache.delete(token);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Query user profile from admin_users (trusted database source)
    const { data: adminUser, error: dbError } = await supabase
      .from('admin_users')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (!adminUser) {
      authCache.delete(token);
      return res.status(403).json({ error: 'Access denied. Account is not registered as an authorized staff user.' });
    }

    if (adminUser.is_active === false) {
      authCache.delete(token);
      return res.status(403).json({ error: 'Access denied. Account is deactivated.' });
    }

    // Canonical hardcoded staff emails guarantee correct role assignment even if DB check constraint is legacy
    const STAFF_EMAIL_ROLES = {
      'sales@gmail.com': 'SALES',
      'tech@gmail.com': 'TECHNICAL',
      'store@gmail.com': 'STORE_MANAGER',
      'coordinator@gmail.com': 'COORDINATOR',
    };

    // Resolve authoritative role from trusted database record & server-signed auth identity
    let role = null;
    const userEmail = (user.email || '').toLowerCase().trim();
    const dbRole = adminUser.role ? String(adminUser.role).trim().toUpperCase() : '';
    const DEPARTMENT_ROLES = ['SALES', 'TECHNICAL', 'STORE_MANAGER', 'COORDINATOR'];
    const appRole = (user.app_metadata?.role || '').toUpperCase();
    const userMetaRole = (user.user_metadata?.role || '').toUpperCase();

    if (STAFF_EMAIL_ROLES[userEmail]) {
      role = STAFF_EMAIL_ROLES[userEmail];
    } else if (DEPARTMENT_ROLES.includes(dbRole)) {
      role = dbRole;
    } else if (DEPARTMENT_ROLES.includes(appRole)) {
      role = appRole;
    } else if (DEPARTMENT_ROLES.includes(userMetaRole)) {
      role = userMetaRole;
    } else if (dbRole === 'ADMIN' || dbRole === 'SUPER_ADMIN' || appRole === 'ADMIN' || appRole === 'SUPER_ADMIN') {
      role = 'ADMIN';
    }

    if (!role) {
      authCache.delete(token);
      return res.status(403).json({ error: 'Access denied. No valid operational role assigned to account.' });
    }

    const authData = {
      user,
      adminUser: { ...adminUser, role },
      profile: { ...adminUser, id: user.id, email: user.email, role },
      expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
    };

    // Store in cache (limit max entries to 1000)
    if (authCache.size > 1000) {
      const firstKey = authCache.keys().next().value;
      authCache.delete(firstKey);
    }
    authCache.set(token, authData);

    req.user = authData.user;
    req.adminUser = authData.adminUser;
    req.profile = authData.profile;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Middleware requiring Admin role
 */
export const requireAdmin = [
  requireAuth,
  (req, res, next) => {
    const role = (req.profile?.role || '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }
    next();
  },
];

/**
 * Middleware requiring any of the specified roles.
 * Least-privilege access: denies by default unless the user's role is explicitly allowed.
 */
export function requireRole(...allowedRoles) {
  const flattened = allowedRoles.flat().map((r) => String(r).toUpperCase());
  return [
    requireAuth,
    (req, res, next) => {
      const userRole = req.profile?.role;
      if (!userRole) {
        return res.status(403).json({ error: 'Access denied. Missing authorized role.' });
      }

      if (flattened.includes(userRole)) {
        return next();
      }

      return res.status(403).json({
        error: `Access denied. Required role: ${flattened.join(' or ')}`,
      });
    },
  ];
}
