import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AccessDenied from './AccessDenied';

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-3 border-navy border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/**
 * RoleProtectedRoute enforces authentication and role-based authorization:
 * 1. Shows PageLoader while session and profile are loading (preserves session on page refresh).
 * 2. Unauthenticated users are redirected directly to /login.
 * 3. Unauthorized users see the AccessDenied page.
 * 4. Authorized users see the protected workspace children.
 */
export default function RoleProtectedRoute({
  allowedRoles = [],
  targetResource = 'this workspace',
  children,
}) {
  const { session, role, loading } = useAuth();

  if (loading) {
    return <PageLoader />;
  }

  // 1. Unauthenticated: Redirect to login page
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // 2. Unauthorized: Render Access Denied page
  const userRole = (role || '').toUpperCase();
  const normalizedAllowed = allowedRoles.map((r) => String(r).toUpperCase());
  const isAllowed = normalizedAllowed.includes(userRole);

  if (!isAllowed) {
    return (
      <main className="min-h-screen bg-gray-50 p-4 sm:p-6 flex items-center justify-center">
        <AccessDenied targetResource={targetResource} />
      </main>
    );
  }

  // 3. Authorized
  return children;
}
