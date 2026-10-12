import { useEffect, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import ActiveSessionCleanupTracker from './components/ActiveSessionCleanupTracker';
import { pingServerWakeup } from './lib/api';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const FeedbackForm = lazy(() => import('./pages/FeedbackForm'));
const Login = lazy(() => import('./pages/admin/Login'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-3 border-navy border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { session, loading } = useAuth();

  if (loading) {
    return <PageLoader />;
  }

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* 1. Public Landing Page (Portal Selection) */}
        <Route path="/" element={<LandingPage />} />

        {/* 2. Public Customer Feedback Form */}
        <Route path="/customer-form" element={<FeedbackForm />} />
        <Route path="/feedback" element={<FeedbackForm />} />

        {/* 3. Staff & Admin Login Routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/admin/login" element={<Login />} />

        {/* 4. Protected Workspace & Admin Dashboard Routes */}
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/installation-checklists"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/installation-checklists/create"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/installation-checklists/:id"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/installation-checklists/:id/edit"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        {/* 5. Direct Workspace & Resource URLs (Guarded) */}
        <Route
          path="/sales"
          element={
            <ProtectedRoute>
              <Navigate to="/admin/dashboard?tab=sales_workspace" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/technical"
          element={
            <ProtectedRoute>
              <Navigate to="/admin/dashboard?tab=technical_workspace" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/store-manager"
          element={
            <ProtectedRoute>
              <Navigate to="/admin/dashboard?tab=store_workspace" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/quotation-history"
          element={
            <ProtectedRoute>
              <Navigate to="/admin/dashboard?tab=quotation_history" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/quotation-generator"
          element={
            <ProtectedRoute>
              <Navigate to="/admin/dashboard?tab=quotation_generator" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/employee-accounts"
          element={
            <ProtectedRoute>
              <Navigate to="/admin/dashboard?tab=users" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <ProtectedRoute>
              <Navigate to="/admin/dashboard?tab=customers" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <ProtectedRoute>
              <Navigate to="/admin/dashboard?tab=audit_logs" replace />
            </ProtectedRoute>
          }
        />
        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />

        {/* 404 fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  // Proactively wake up backend on initial application boot
  useEffect(() => {
    pingServerWakeup();
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
