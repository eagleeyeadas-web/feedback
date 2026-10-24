import { useEffect, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import RoleProtectedRoute from './components/RoleProtectedRoute';
import AccessDenied from './components/AccessDenied';
import ActiveSessionCleanupTracker from './components/ActiveSessionCleanupTracker';
import { pingServerWakeup } from './lib/api';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const FeedbackForm = lazy(() => import('./pages/FeedbackForm'));
const Login = lazy(() => import('./pages/admin/Login'));
const SalesWorkspacePage = lazy(() => import('./pages/staff/SalesWorkspacePage'));
const TechnicalWorkspacePage = lazy(() => import('./pages/staff/TechnicalWorkspacePage'));
const StoreWorkspacePage = lazy(() => import('./pages/staff/StoreWorkspacePage'));
const CoordinatorWorkspacePage = lazy(() => import('./pages/staff/CoordinatorWorkspacePage'));
const HrWorkspacePage = lazy(() => import('./pages/staff/HrWorkspacePage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-3 border-navy border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/**
 * Redirects authenticated staff to their specific authorized workspace.
 * Prevents multiple workspaces from appearing together on an un-scoped dashboard.
 */
function DashboardRedirect() {
  const { session, role, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <PageLoader />;
  }

  if (!session) {
    const currentPath = location.pathname + location.search + location.hash;
    const redirectParam = currentPath && currentPath !== '/' ? `?redirect=${encodeURIComponent(currentPath)}` : '?redirect=%2Fadmin%2Fdashboard';
    return <Navigate to={`/login${redirectParam}`} replace />;
  }

  const userRole = (role || '').toUpperCase();
  if (userRole === 'SALES') {
    return <Navigate to="/sales" replace />;
  }
  if (userRole === 'TECHNICAL') {
    return <Navigate to="/technical" replace />;
  }
  if (userRole === 'STORE_MANAGER') {
    return <Navigate to="/store-manager" replace />;
  }
  if (userRole === 'COORDINATOR') {
    return <Navigate to="/coordinator" replace />;
  }
  if (userRole === 'HR') {
    return <Navigate to="/hr" replace />;
  }

  // Fallback for Admin
  return <Navigate to="/sales" replace />;
}

/**
 * Helper to route checklist detail links to the user's authorized workspace.
 * Preserves the exact checklist ID and destination when authentication is required.
 */
function ChecklistDetailRedirect() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { session, role, loading } = useAuth();

  if (loading) return <PageLoader />;

  const action = searchParams.get('action');
  const actionQuery = action ? `&action=${action}` : '';

  if (!session) {
    const targetUrl = `/admin/installation-checklists/${id}${action ? `?action=${action}` : ''}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(targetUrl)}`} replace />;
  }

  const userRole = (role || '').toUpperCase();

  if (userRole === 'TECHNICAL') {
    return <Navigate to={`/technical?view=${id}${actionQuery}`} replace />;
  }
  if (userRole === 'STORE_MANAGER') {
    return <Navigate to={`/store-manager?view=${id}${actionQuery}`} replace />;
  }
  if (userRole === 'COORDINATOR') {
    return <Navigate to={`/coordinator?view=${id}&checklist=${id}${actionQuery}`} replace />;
  }
  if (userRole === 'HR') {
    return <Navigate to={`/hr?view=${id}${actionQuery}`} replace />;
  }
  if (userRole === 'SALES' || userRole === 'ADMIN') {
    return <Navigate to={`/sales?view=${id}${actionQuery}`} replace />;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 flex items-center justify-center">
      <AccessDenied targetResource="Installation Checklist Details" />
    </main>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* 1. Public Landing Page */}
        <Route path="/" element={<LandingPage />} />

        {/* 2. Public Customer Evaluation & Feedback Form */}
        <Route path="/customer-form" element={<FeedbackForm />} />
        <Route path="/feedback" element={<FeedbackForm />} />

        {/* 3. Single Staff Login Page */}
        <Route path="/login" element={<Login />} />
        <Route path="/admin/login" element={<Login />} />

        {/* 4. Dedicated Department Workspaces with Strict Role Route Protection */}
        {/* Sales Workspace: Accessible ONLY to SALES */}
        <Route
          path="/sales"
          element={
            <RoleProtectedRoute
              allowedRoles={['SALES', 'ADMIN']}
              targetResource="Sales Workspace"
            >
              <SalesWorkspacePage />
            </RoleProtectedRoute>
          }
        />

        {/* Technical Workspace: Accessible ONLY to TECHNICAL */}
        <Route
          path="/technical"
          element={
            <RoleProtectedRoute
              allowedRoles={['TECHNICAL', 'ADMIN']}
              targetResource="Technical Workspace"
            >
              <TechnicalWorkspacePage />
            </RoleProtectedRoute>
          }
        />

        {/* Store Manager Workspace: Accessible ONLY to STORE_MANAGER */}
        <Route
          path="/store-manager"
          element={
            <RoleProtectedRoute
              allowedRoles={['STORE_MANAGER', 'ADMIN']}
              targetResource="Store Manager Workspace"
            >
              <StoreWorkspacePage />
            </RoleProtectedRoute>
          }
        />
        <Route path="/store" element={<Navigate to="/store-manager" replace />} />

        {/* Coordinator Workspace: Accessible ONLY to COORDINATOR */}
        <Route
          path="/coordinator"
          element={
            <RoleProtectedRoute
              allowedRoles={['COORDINATOR', 'ADMIN']}
              targetResource="Coordinator Workspace"
            >
              <CoordinatorWorkspacePage />
            </RoleProtectedRoute>
          }
        />

        {/* HR Workspace: Accessible ONLY to HR and ADMIN */}
        <Route
          path="/hr"
          element={
            <RoleProtectedRoute
              allowedRoles={['HR', 'ADMIN']}
              targetResource="HR Workspace"
            >
              <HrWorkspacePage />
            </RoleProtectedRoute>
          }
        />

        {/* 5. Legacy / Nested Checklist Redirects */}
        <Route
          path="/admin/installation-checklists"
          element={<DashboardRedirect />}
        />
        <Route
          path="/admin/installation-checklists/create"
          element={
            <RoleProtectedRoute
              allowedRoles={['SALES', 'ADMIN']}
              targetResource="Create Installation Checklist"
            >
              <Navigate to="/sales?create=true" replace />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/admin/installation-checklists/:id"
          element={<ChecklistDetailRedirect />}
        />
        <Route
          path="/admin/installation-checklists/:id/edit"
          element={
            <RoleProtectedRoute
              allowedRoles={['SALES', 'ADMIN']}
              targetResource="Edit Installation Checklist"
            >
              <Navigate to="/sales" replace />
            </RoleProtectedRoute>
          }
        />

        {/* 6. Quotation Routes mapped to Sales Workspace */}
        <Route
          path="/admin/quotations"
          element={
            <RoleProtectedRoute
              allowedRoles={['SALES', 'ADMIN']}
              targetResource="Quotation Records"
            >
              <Navigate to="/sales?tab=quotation-history" replace />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/admin/quotation-generator"
          element={
            <RoleProtectedRoute
              allowedRoles={['SALES', 'ADMIN']}
              targetResource="Quotation Generator"
            >
              <Navigate to="/sales?tab=quotation-generator" replace />
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/quotations"
          element={<Navigate to="/sales?tab=quotation-history" replace />}
        />

        {/* 7. Dashboard & Direct Admin URLs Route to Authorized Department Workspace */}
        <Route path="/admin/dashboard" element={<DashboardRedirect />} />
        <Route path="/admin" element={<DashboardRedirect />} />

        {/* 7. 404 Fallback: Informative screen instead of silent redirect */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  // Proactively wake up backend on initial boot
  useEffect(() => {
    pingServerWakeup();
  }, []);

  // Listen for service worker notification click messages when app is already open
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      const handleMessage = (event) => {
        if (event.data?.type === 'SAFDRIVE_NOTIFICATION_CLICK' && event.data.url) {
          try {
            const rawUrl = event.data.url;
            let targetHash = '';
            if (rawUrl.includes('#')) {
              targetHash = '#' + rawUrl.split('#')[1];
            } else {
              const u = new URL(rawUrl, window.location.origin);
              targetHash = `#${u.pathname}${u.search}`;
            }
            if (targetHash && targetHash !== window.location.hash) {
              window.location.hash = targetHash;
            }
          } catch (e) {
            console.warn('[App] Error navigating from push notification message:', e);
          }
        }
      };

      navigator.serviceWorker.addEventListener('message', handleMessage);
      return () => {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      };
    }
  }, []);

  return (
    <HashRouter>
      <AuthProvider>
        <ActiveSessionCleanupTracker />
        <AppRoutes />
      </AuthProvider>
    </HashRouter>
  );
}
