import { Link, useLocation } from 'react-router-dom';
import { LayoutGrid, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function Navbar({ showBackToPortals = false }) {
  const location = useLocation();
  const { session, signOut, role } = useAuth();
  
  const isCustomerPage = location.pathname === '/customer-form' || location.pathname === '/feedback';
  const isLoginPage = location.pathname === '/login' || location.pathname === '/admin/login';
  const isAdminWorkspace = location.pathname.startsWith('/admin') && !isLoginPage;

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 sm:py-2.5 flex items-center justify-between gap-2 sm:gap-4">
        
        {/* Brand / Logo */}
        <Link to="/" className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0 group">
          <img
            src="/logo.png"
            alt="Eagle Eye SafDrive"
            className="h-8 sm:h-10 w-auto object-contain shrink-0 transition-transform group-hover:scale-105"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <div className="min-w-0">
            <h1 className="text-xs sm:text-sm md:text-base font-bold text-navy leading-tight tracking-tight whitespace-nowrap">
              EAGLE EYE SAFDRIVE <span className="hidden sm:inline">PVT LTD</span>
            </h1>
            <p className="text-[10px] text-gray-500 leading-tight hidden md:block">
              Customer Feedback &amp; Evaluation Portal
            </p>
          </div>
        </Link>

        {/* Right Navigation / Action Area */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Back to Portals link when inside Customer Form or Staff Login */}
          {(isCustomerPage || isLoginPage || showBackToPortals) && (
            <Link
              to="/"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:text-navy hover:bg-gray-100 border border-gray-200 transition-all shadow-xs"
            >
              <LayoutGrid size={14} className="text-navy" />
              <span>Portals</span>
            </Link>
          )}

          {/* Authenticated Staff in Workspace */}
          {session && isAdminWorkspace && (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-block text-[11px] font-bold text-navy bg-navy/5 px-2.5 py-1 rounded-md border border-navy/10 uppercase tracking-wider">
                {role || 'STAFF'}
              </span>
              <button
                onClick={signOut}
                title="Sign Out"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:text-red-600 hover:bg-red-50 border border-gray-200 transition-colors cursor-pointer"
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
      
      {/* Accent Line - Thin Red Divider */}
      <div className="h-0.5 bg-red-accent w-full" />
    </header>
  );
}

