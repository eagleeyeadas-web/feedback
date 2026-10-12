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

    // Query user profile from admin_users (if profile row exists)
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (adminUser && adminUser.is_active === false) {
      authCache.delete(token);
      return res.status(403).json({ error: 'Access denied. Account is deactivated.' });
    }

    // Resolve authoritative role from Supabase Auth metadata or admin_users profile
    let role = (
      user.app_metadata?.role ||
      user.user_metadata?.role ||
      adminUser?.role ||
      'ADMIN'
    ).toUpperCase();

    const authData = {
      user,
      adminUser: adminUser || { id: user.id, email: user.email, role },
      profile: { ...(adminUser || {}), id: user.id, email: user.email, role },
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
 * Middleware requiring Admin or Super Admin role
 */
export const requireAdmin = [
  requireAuth,
  (req, res, next) => {
    const role = req.profile?.role;
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }
    next();
  },
];

/**
 * Middleware requiring any of the specified roles.
 * Admins/Super Admins only pass if explicitly allowed or when 'ADMIN' is included in allowedRoles.
 */
export function requireRole(...allowedRoles) {
  return [
    requireAuth,
    (req, res, next) => {
      const userRole = req.profile?.role;
      const isAllowed =
        allowedRoles.includes(userRole) ||
        (allowedRoles.includes('ADMIN') && (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN'));

      if (isAllowed) {
        return next();
      }
      return res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
      });
    },
  ];
}
