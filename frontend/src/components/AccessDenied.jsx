import { ShieldAlert, ArrowRight, Lock, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const DEFAULT_WORKSPACE_BY_ROLE = {
  SALES: {
    path: '/sales',
    name: 'Sales Workspace',
  },
  TECHNICAL: {
    path: '/technical',
    name: 'Technical Workspace',
  },
  STORE_MANAGER: {
    path: '/store-manager',
    name: 'Store Manager Workspace',
  },
  COORDINATOR: {
    path: '/coordinator',
    name: 'Coordinator Workspace',
  },
  ADMIN: {
    path: '/sales',
    name: 'Sales Workspace',
  },
};

const ROLE_PERMITTED_DESCRIPTIONS = {
  SALES: 'Customer intake, Sales Workspace, Quotations, and Installation job creation.',
  TECHNICAL: 'Technical Workspace, device carry recording, installation reports, and return declarations.',
  STORE_MANAGER: 'Store Manager Workspace, device inventory receipts, adjustments, and return verification.',
  COORDINATOR: 'Coordinator Workspace, travel and accommodation bookings for technical jobs.',
  ADMIN: 'System-wide administration, user management, and operational oversight.',
};

export default function AccessDenied({ targetResource = 'this workspace', onNavigateDefault }) {
  const { user, role } = useAuth();
  const navigate = useNavigate();

  const userRole = (role || '').toUpperCase();
  const defaultTarget = DEFAULT_WORKSPACE_BY_ROLE[userRole] || DEFAULT_WORKSPACE_BY_ROLE.SALES;
  const permittedDesc = ROLE_PERMITTED_DESCRIPTIONS[userRole] || 'Your assigned workspace.';

  const handleReturn = () => {
    if (onNavigateDefault) {
      onNavigateDefault(defaultTarget.path);
    } else {
      navigate(defaultTarget.path, { replace: true });
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-red-100 overflow-hidden text-center">
        {/* Header banner */}
        <div className="bg-gradient-to-r from-red-600 to-rose-700 p-6 text-white flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center mb-3 shadow-inner">
            <ShieldAlert size={32} className="text-white" />
          </div>
          <span className="text-xs uppercase tracking-widest font-bold bg-white/20 px-3 py-1 rounded-full text-white/90">
            HTTP 403 Forbidden
          </span>
          <h2 className="text-xl font-bold mt-2">Access Denied</h2>
        </div>

        {/* Body content */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-700">
            You do not have permission to access <strong className="text-navy">{targetResource}</strong>.
          </p>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 text-xs text-left space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-gray-500 font-medium">Logged in as:</span>
              <span className="text-navy font-semibold truncate max-w-[200px]">{user?.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 font-medium">Assigned Role:</span>
              <span className="font-bold px-2 py-0.5 rounded text-[11px] bg-red-100 text-red-800">
                {userRole}
              </span>
            </div>
            <div className="pt-2 border-t border-gray-200 text-gray-600">
              <span className="font-medium text-gray-700">Permitted operations: </span>
              {permittedDesc}
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Workspace access is strictly enforced by role-based authorization. If you need access to this page, please contact a Super Administrator.
          </p>

          <div className="pt-2">
            <button
              onClick={handleReturn}
              className="w-full flex items-center justify-center gap-2 bg-navy hover:bg-navy-light text-white font-semibold py-3 px-4 rounded-xl transition-colors shadow-md cursor-pointer text-sm"
            >
              <span>Go to {defaultTarget.name}</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
