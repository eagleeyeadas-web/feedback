import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  Briefcase,
  Wrench,
  Warehouse,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  ArrowLeft,
  Shield,
} from 'lucide-react';
import Navbar from '../../components/Navbar';

const PORTAL_CONFIG = {
  sales: {
    id: 'sales',
    name: 'Sales Portal',
    title: 'Sales Portal Login',
    subtitle: 'Sign in to access your Sales Workspace & Quotations',
    icon: Briefcase,
    color: 'blue',
    iconClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    btnClass: 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/30',
    tabActiveClass: 'bg-blue-600 text-white shadow-sm',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    expectedRole: 'SALES',
    placeholderEmail: 'sales@gmail.com',
  },
  technical: {
    id: 'technical',
    name: 'Technical Team',
    title: 'Technical Team Login',
    subtitle: 'Sign in to access Assigned Jobs & Installation Reports',
    icon: Wrench,
    color: 'teal',
    iconClass: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
    btnClass: 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-600/30',
    tabActiveClass: 'bg-teal-600 text-white shadow-sm',
    badgeClass: 'bg-teal-50 text-teal-700 border-teal-200',
    expectedRole: 'TECHNICAL',
    placeholderEmail: 'tech@gmail.com',
  },
  store: {
    id: 'store',
    name: 'Store Manager',
    title: 'Store Manager Login',
    subtitle: 'Sign in to manage Stock, Device Carry & Returns',
    icon: Warehouse,
    color: 'purple',
    iconClass: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    btnClass: 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-600/30',
    tabActiveClass: 'bg-purple-600 text-white shadow-sm',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
    expectedRole: 'STORE_MANAGER',
    placeholderEmail: 'store@gmail.com',
  },
  admin: {
    id: 'admin',
    name: 'Administrator',
    title: 'Administrative Access',
    subtitle: 'Authorized System Administrator & Security Access',
    icon: Lock,
    color: 'navy',
    iconClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    btnClass: 'bg-navy hover:bg-navy-light text-white shadow-navy/30',
    tabActiveClass: 'bg-navy text-white shadow-sm',
    badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
    expectedRole: 'ADMIN',
    placeholderEmail: 'admin@eagleeye.com',
  },
};

export default function Login() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { signIn, session } = useAuth();

  // Determine active portal from query params or route
  const isAdminDirect = location.pathname === '/admin/login' && !searchParams.get('portal');
  const initialPortal = isAdminDirect
    ? 'admin'
    : (searchParams.get('portal') || 'sales').toLowerCase();

  const [activePortalKey, setActivePortalKey] = useState(
    PORTAL_CONFIG[initialPortal] ? initialPortal : 'sales'
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Sync with URL query parameter if it changes
  useEffect(() => {
    const portalParam = searchParams.get('portal');
    if (portalParam && PORTAL_CONFIG[portalParam.toLowerCase()]) {
      setActivePortalKey(portalParam.toLowerCase());
    } else if (isAdminDirect) {
      setActivePortalKey('admin');
    }
  }, [searchParams, isAdminDirect]);

  const currentPortal = PORTAL_CONFIG[activePortalKey] || PORTAL_CONFIG.sales;
  const IconComponent = currentPortal.icon;

  const handlePortalSwitch = (key) => {
    setActivePortalKey(key);
    setError('');
    setSearchParams({ portal: key });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter both email and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const authData = await signIn(email.trim(), password);
      const user = authData?.user;
      const userRole = (
        user?.app_metadata?.role ||
        user?.user_metadata?.role ||
        'ADMIN'
      ).toUpperCase();

      // Determine destination tab based on user's authorized role
      let destinationTab = 'installation_checklists';
      if (userRole === 'SALES') {
        destinationTab = 'sales_workspace';
      } else if (userRole === 'TECHNICAL') {
        destinationTab = 'technical_workspace';
      } else if (userRole === 'STORE_MANAGER') {
        destinationTab = 'store_workspace';
      } else if (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN') {
        destinationTab = 'installation_checklists';
      }

      navigate(`/admin/dashboard?tab=${destinationTab}`, { replace: true });
    } catch (err) {
      console.error('Authentication failure:', err);
      setError(err.message || 'Invalid email or password. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#060f2e] via-[#0a1946] to-[#0c1f54] flex flex-col text-slate-100">
      <Navbar showBackToPortals={true} />

      <div className="flex-1 flex items-center justify-center px-4 py-10 relative">
        {/* Subtle Ambient Background Accents */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 50% 20%, rgba(59, 130, 246, 0.3) 0%, transparent 60%)',
          }}
        />

        <div className="max-w-md w-full relative z-10">
          {/* Back to Portals link */}
          <div className="mb-5 flex items-center justify-between">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-200/80 hover:text-white transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Back to Portal Selection</span>
            </Link>

            <span className="text-[11px] font-medium text-slate-400">
              Eagle Eye SafDrive
            </span>
          </div>

          {/* Segmented Switcher for the 3 Staff Portals (unless admin direct) */}
          {!isAdminDirect && (
            <div className="bg-white/10 backdrop-blur-md p-1 rounded-xl mb-5 flex items-center border border-white/15">
              <button
                type="button"
                onClick={() => handlePortalSwitch('sales')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activePortalKey === 'sales'
                    ? PORTAL_CONFIG.sales.tabActiveClass
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <Briefcase size={13} />
                <span>Sales</span>
              </button>

              <button
                type="button"
                onClick={() => handlePortalSwitch('technical')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activePortalKey === 'technical'
                    ? PORTAL_CONFIG.technical.tabActiveClass
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <Wrench size={13} />
                <span>Technical</span>
              </button>

              <button
                type="button"
                onClick={() => handlePortalSwitch('store')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  activePortalKey === 'store'
                    ? PORTAL_CONFIG.store.tabActiveClass
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <Warehouse size={13} />
                <span>Store</span>
              </button>
            </div>
          )}

          {/* Portal Login Card */}
          <div className="bg-white rounded-3xl shadow-2xl p-6 sm:p-8 text-gray-900 border border-gray-100">
            {/* Header / Portal Badge */}
            <div className="text-center mb-6">
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3.5 border shadow-inner transition-transform ${currentPortal.iconClass}`}
              >
                <IconComponent size={28} strokeWidth={2.2} />
              </div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                {currentPortal.title}
              </h1>
              <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
                {currentPortal.subtitle}
              </p>
            </div>

            {/* Error Notification */}
            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 mb-5 text-xs text-rose-700 flex items-start gap-2">
                <span className="font-bold shrink-0">Error:</span>
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="staff-email"
                  className="block text-xs font-bold text-gray-700 mb-1"
                >
                  Work Email Address <span className="text-rose-500">*</span>
                </label>
                <input
                  id="staff-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full text-xs sm:text-sm px-3.5 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600 transition-all font-medium text-gray-900 placeholder:text-gray-400"
                  placeholder={currentPortal.placeholderEmail}
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="staff-password"
                  className="block text-xs font-bold text-gray-700 mb-1"
                >
                  Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="staff-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full text-xs sm:text-sm px-3.5 py-2.5 pr-10 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600 transition-all font-medium text-gray-900 placeholder:text-gray-400"
                    placeholder="Enter your account password"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer p-1"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition-all duration-200 cursor-pointer ${currentPortal.btnClass} ${
                    loading ? 'opacity-80 cursor-not-allowed' : ''
                  }`}
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Authenticating...</span>
                    </>
                  ) : (
                    <span>Sign In to {currentPortal.name}</span>
                  )}
                </button>
              </div>
            </form>

            <div className="mt-6 pt-4 border-t border-gray-100 text-center">
              <p className="text-[11px] text-gray-400">
                Authorized staff access only &bull; Secured with Supabase RBAC
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
