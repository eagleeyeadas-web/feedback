import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Shield } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import PushNotificationManager from '../notifications/PushNotificationManager';

export default function StaffWorkspaceLayout({
  title,
  departmentBadge,
  badgeColorClass = 'bg-blue-50 text-blue-700 border-blue-200',
  icon: IconComponent,
  children,
}) {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const roleBadgeColors = {
    SALES: 'bg-blue-100 text-blue-800 border-blue-300',
    TECHNICAL: 'bg-teal-100 text-teal-800 border-teal-300',
    STORE_MANAGER: 'bg-amber-100 text-amber-800 border-amber-300',
    COORDINATOR: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    HR: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    ADMIN: 'bg-purple-100 text-purple-800 border-purple-300',
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 1. Header Navigation Bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-2.5 sm:px-6 py-2 sm:py-3 flex items-center justify-between gap-2 sm:gap-4">
          {/* Brand & Department Badge */}
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
            <Link to="/" className="flex items-center gap-2 shrink-0 group">
              <img
                src="/logo.png"
                alt="Eagle Eye SafDrive"
                className="h-7 sm:h-9 w-auto object-contain transition-transform group-hover:scale-105 shrink-0"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
              <div className="hidden sm:block">
                <span className="text-xs sm:text-sm font-black text-navy tracking-tight block leading-tight">
                  EAGLE EYE SAFDRIVE
                </span>
                <span className="text-[10px] text-gray-500 font-medium block leading-tight">
                  Enterprise Fleet Safety
                </span>
              </div>
            </Link>

            <div className="h-5 w-px bg-gray-200 hidden sm:block" />

            {/* Department Workspace Indicator */}
            <div className="flex items-center min-w-0">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-[11px] sm:text-xs font-bold border truncate ${badgeColorClass}`}
              >
                {IconComponent && <IconComponent size={13} className="shrink-0" />}
                <span className="truncate max-w-[95px] xs:max-w-[140px] sm:max-w-none">{departmentBadge || title}</span>
              </span>
            </div>
          </div>

          {/* Right Action Area: User Identity & Sign Out */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* User & Role Badge */}
            <div className="hidden md:flex flex-col items-end text-right">
              <span className="text-xs font-bold text-gray-800 leading-tight truncate max-w-[220px]">
                {user?.email}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border mt-0.5 uppercase tracking-wider ${
                  roleBadgeColors[role] || 'bg-gray-100 text-gray-700 border-gray-200'
                }`}
              >
                Role: {role}
              </span>
            </div>

            {/* Mobile simplified role badge */}
            <span
              className={`md:hidden text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase shrink-0 ${
                roleBadgeColors[role] || 'bg-gray-100 text-gray-700'
              }`}
            >
              {role}
            </span>

            {/* Mobile Push Notification Preferences / Toggle */}
            <PushNotificationManager compact={true} />

            {/* Sign Out Button */}
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign Out of Workspace"
              className="inline-flex items-center justify-center gap-1.5 p-1.5 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold text-gray-700 hover:text-red-700 hover:bg-red-50 border border-gray-200 hover:border-red-200 transition-all cursor-pointer shadow-2xs shrink-0"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>

        {/* Accent Red Line Divider */}
        <div className="h-0.5 bg-red-accent w-full" />
      </header>

      {/* 2. Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-2.5 sm:p-6 lg:p-8">
        {children}
      </main>

      {/* 3. Footer */}
      <footer className="border-t border-gray-200 bg-white py-4 px-6 text-center text-xs text-gray-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-gray-600 font-semibold text-[11px]">
            <Shield size={13} className="text-blue-600" />
            <span>Eagle Eye SafDrive Pvt Ltd &bull; Departmental Access Protected</span>
          </div>
          <span className="text-[10px] text-gray-400">
            Session authenticated via Supabase Auth &bull; Authorized Operational Staff
          </span>
        </div>
      </footer>
    </div>
  );
}
