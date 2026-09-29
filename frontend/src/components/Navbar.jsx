import { Link, useLocation } from 'react-router-dom';
import { FileText, Shield, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function Navbar() {
  const location = useLocation();
  const { session, signOut } = useAuth();
  
  const isAdminPath = location.pathname.startsWith('/admin');

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 sm:py-2.5 flex items-center justify-between gap-2 sm:gap-4">
        
        {/* Brand / Logo */}
        <Link to="/" className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
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

        {/* Switcher Navigation */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="bg-gray-100 p-1 rounded-xl flex items-center border border-gray-200">
            {/* Customer Form Link */}
            <Link
              to="/"
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs font-semibold transition-all ${
                !isAdminPath
                  ? 'bg-navy text-white shadow-xs'
                  : 'text-gray-600 hover:text-navy hover:bg-gray-200/60'
              }`}
            >
              <FileText size={14} className="shrink-0" />
              <span>
                <span className="hidden sm:inline">Customer </span>Form
              </span>
            </Link>

            {/* Admin Portal Link */}
            <Link
              to={session ? "/admin/dashboard" : "/admin/login"}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs font-semibold transition-all ${
                isAdminPath
                  ? 'bg-navy text-white shadow-xs'
                  : 'text-gray-600 hover:text-navy hover:bg-gray-200/60'
              }`}
            >
              <Shield size={14} className="shrink-0" />
              <span>
                Admin<span className="hidden sm:inline"> Portal</span>
              </span>
            </Link>
          </div>

          {/* Sign Out button if logged in as admin */}
          {session && isAdminPath && (
            <button
              onClick={signOut}
              title="Sign Out"
              className="p-1.5 sm:p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 border border-gray-200 transition-colors cursor-pointer"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
      
      {/* Accent Line */}
      <div className="h-0.5 bg-red-accent w-full" />
    </header>
  );
}

