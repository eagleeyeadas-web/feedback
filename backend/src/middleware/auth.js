import supabase from '../services/supabase.js';

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
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Query user profile from admin_users
    const { data: adminUser, error: adminError } = await supabase
      .from('admin_users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (adminError || !adminUser || adminUser.is_active === false) {
      return res.status(403).json({ error: 'Access denied. Active account required.' });
    }

    let role = (adminUser.role || 'ADMIN').toUpperCase();
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') role = 'ADMIN';

    req.user = user;
    req.adminUser = { ...adminUser, role };
    req.profile = { ...adminUser, role };
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
    if (req.profile.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }
    next();
  },
];

/**
 * Middleware requiring any of the specified roles (ADMIN always allowed)
 */
export function requireRole(...allowedRoles) {
  return [
    requireAuth,
    (req, res, next) => {
      const userRole = req.profile.role;
      if (userRole === 'ADMIN' || allowedRoles.includes(userRole)) {
        return next();
      }
      return res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
      });
    },
  ];
}
