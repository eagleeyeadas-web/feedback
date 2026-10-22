import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  Loader2,
  ArrowLeft,
  Shield,
  AlertCircle,
  Briefcase,
  Wrench,
  Warehouse,
  CalendarCheck,
  CheckCircle2,
  LogOut,
  ArrowRight,
  UserCheck,
} from 'lucide-react';
import Navbar from '../../components/Navbar';

const PORTALS = {
  sales: {
    id: 'sales',
    name: 'Sales Portal',
    shortName: 'Sales',
    title: 'Sales Portal Sign In',
    subtitle: 'Client intake, installation checklists & quotation generator',
    role: 'SALES',
    defaultEmail: 'sales@gmail.com',
    targetPath: '/sales',
    badge: 'Sales & Quotations',
    icon: Briefcase,
    color: 'blue',
    badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-400/30',
    btnClass: 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/30 hover:shadow-blue-600/40',
    iconBgClass: 'bg-blue-500/20 text-blue-300 border-blue-400/30',
    activeTabClass: 'bg-blue-600 text-white shadow-md shadow-blue-600/30',
  },
  technical: {
    id: 'technical',
    name: 'Technical Team',
    shortName: 'Technical',
    title: 'Technical Team Sign In',
    subtitle: 'Field operations, assigned jobs & installation reports',
    role: 'TECHNICAL',
    defaultEmail: 'tech@gmail.com',
    targetPath: '/technical',
    badge: 'Field Engineering',
    icon: Wrench,
    color: 'teal',
    badgeClass: 'bg-teal-500/20 text-teal-300 border-teal-400/30',
    btnClass: 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/30 hover:shadow-teal-600/40',
    iconBgClass: 'bg-teal-500/20 text-teal-300 border-teal-400/30',
    activeTabClass: 'bg-teal-600 text-white shadow-md shadow-teal-600/30',
  },
  store: {
    id: 'store',
    name: 'Store Manager',
    shortName: 'Store',
    title: 'Store Manager Sign In',
    subtitle: 'Inventory management, stock dispatch & technician returns',
    role: 'STORE_MANAGER',
    defaultEmail: 'store@gmail.com',
    targetPath: '/store-manager',
    badge: 'Stock & Logistics',
    icon: Warehouse,
    color: 'purple',
    badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-400/30',
    btnClass: 'bg-purple-600 hover:bg-purple-700 shadow-purple-600/30 hover:shadow-purple-600/40',
    iconBgClass: 'bg-purple-500/20 text-purple-300 border-purple-400/30',
    activeTabClass: 'bg-purple-600 text-white shadow-md shadow-purple-600/30',
  },
  coordinator: {
    id: 'coordinator',
    name: 'Coordinator',
    shortName: 'Coordinator',
    title: 'Coordinator Sign In',
    subtitle: 'Travel arrangements, bus and room booking management',
    role: 'COORDINATOR',
    defaultEmail: 'coordinator@gmail.com',
    targetPath: '/coordinator',
    badge: 'Travel & Accommodation',
    icon: CalendarCheck,
    color: 'indigo',
    badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30',
    btnClass: 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/30 hover:shadow-indigo-600/40',
    iconBgClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30',
    activeTabClass: 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30',
  },
  hr: {
    id: 'hr',
    name: 'HR Portal',
    shortName: 'HR',
    title: 'HR Portal Sign In',
    subtitle: 'Technician availability management & extension approvals',
    role: 'HR',
    defaultEmail: 'hr@gmail.com',
    targetPath: '/hr',
    badge: 'Human Resources',
    icon: UserCheck,
    color: 'emerald',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
    btnClass: 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30 hover:shadow-emerald-600/40',
    iconBgClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
    activeTabClass: 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30',
  },
};

export default function Login() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { signIn, signOut, session, role } = useAuth();

  const portalParam = (searchParams.get('portal') || '').toLowerCase();
  const activePortalKey = PORTALS[portalParam] ? portalParam : 'sales';
  const portalConfig = PORTALS[activePortalKey];

  const [email, setEmail] = useState(portalConfig.defaultEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Sync email prefill when switching portal tabs
  const handleSelectPortal = (key) => {
    setError('');
    setSearchParams({ portal: key });
    const target = PORTALS[key];
    // If current email is empty or was previous portal's default, switch to the new portal default
    const prevDefaults = Object.values(PORTALS).map((p) => p.defaultEmail);
    if (!email || prevDefaults.includes(email.trim().toLowerCase())) {
      setEmail(target.defaultEmail);
    }
    setPassword('');
  };

  // If already authenticated with a role that matches the targeted portal (or admin), redirect immediately.
  // If the active role does NOT match the requested portal, DO NOT auto-redirect to /sales.
  // Instead, allow the user to see the mismatch banner and choose to switch accounts or continue.
  useEffect(() => {
    if (session && role) {
      const userRole = String(role).toUpperCase();
      const targetRole = portalConfig.role;

      // When the user's role matches the requested portal (or user is an Admin), redirect to that workspace
      if (userRole === targetRole) {
        navigate(portalConfig.targetPath, { replace: true });
      } else if (userRole === 'ADMIN') {
        navigate(portalConfig.targetPath, { replace: true });
      } else if (!searchParams.get('portal')) {
        // If no explicit portal requested, route to user's assigned workspace
        if (userRole === 'SALES') navigate('/sales', { replace: true });
        else if (userRole === 'TECHNICAL') navigate('/technical', { replace: true });
        else if (userRole === 'STORE_MANAGER') navigate('/store-manager', { replace: true });
        else if (userRole === 'COORDINATOR') navigate('/coordinator', { replace: true });
        else if (userRole === 'HR') navigate('/hr', { replace: true });
      }
    }
  }, [session, role, portalConfig, searchParams, navigate]);

  const handleSwitchAccount = async () => {
    setLoading(true);
    try {
      await signOut();
      setEmail(portalConfig.defaultEmail);
      setPassword('');
      setError('');
    } finally {
      setLoading(false);
    }
  };

  const handleContinueCurrentSession = () => {
    const userRole = String(role).toUpperCase();
    if (userRole === 'SALES') navigate('/sales', { replace: true });
    else if (userRole === 'TECHNICAL') navigate('/technical', { replace: true });
    else if (userRole === 'STORE_MANAGER') navigate('/store-manager', { replace: true });
    else if (userRole === 'COORDINATOR') navigate('/coordinator', { replace: true });
    else if (userRole === 'HR') navigate('/hr', { replace: true });
    else navigate('/sales', { replace: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError('Please enter both email and password.');
      return;
    }

    setLoading(true);

    try {
      // Authenticate via Supabase Auth and retrieve trusted database role
      const authResult = await signIn(cleanEmail, password);
      const userRole = (authResult?.role || '').toUpperCase();

      if (!userRole) {
        throw new Error('Your account does not have an authorized staff role assigned. Access denied.');
      }

      // Route strictly to the user's authorized department workspace
      if (userRole === 'SALES') {
        navigate('/sales', { replace: true });
      } else if (userRole === 'TECHNICAL') {
        navigate('/technical', { replace: true });
      } else if (userRole === 'STORE_MANAGER') {
        navigate('/store-manager', { replace: true });
      } else if (userRole === 'COORDINATOR') {
        navigate('/coordinator', { replace: true });
      } else if (userRole === 'HR') {
        navigate('/hr', { replace: true });
      } else if (userRole === 'ADMIN') {
        // Admin gets directed to the workspace for the selected portal
        navigate(portalConfig.targetPath || '/sales', { replace: true });
      } else {
        throw new Error('Unauthorized role. Access denied.');
      }
    } catch (err) {
      console.error('Authentication failure:', err);
      const msg = err.message || '';
      if (msg.includes('Invalid login credentials') || msg.includes('invalid_grant')) {
        setError('Invalid email or password. Please verify your credentials and try again.');
      } else if (msg.includes('Email not confirmed')) {
        setError('Your email has not been verified yet in Supabase.');
      } else if (msg.includes('Access denied')) {
        setError(msg);
      } else {
        setError(msg || 'Authentication failed. Please check your network and credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Check if session role doesn't match selected portal
  const isSessionMismatched = session && role && String(role).toUpperCase() !== portalConfig.role && String(role).toUpperCase() !== 'ADMIN';

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#060f2e] via-[#0a1946] to-[#0c1f54] flex flex-col text-slate-100">
      <Navbar showBackToPortals={true} />

      <div className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12 relative">
        {/* Subtle Ambient Radial Glow */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 50% 25%, rgba(59, 130, 246, 0.35) 0%, transparent 65%)',
          }}
        />

        <div className="max-w-2xl w-full relative z-10">
          {/* Back to Portals link */}
          <div className="mb-4 sm:mb-6 flex items-center justify-between">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-200/80 hover:text-white transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Back to Portal Directory</span>
            </Link>

            <span className="text-[11px] font-medium text-slate-400">
              Eagle Eye SafDrive
            </span>
          </div>

          {/* Portal Selector Tabs */}
          <div className="mb-4 bg-white/5 backdrop-blur-md p-1.5 rounded-2xl border border-white/10 flex items-center gap-1 shadow-lg">
            {Object.values(PORTALS).map((portal) => {
              const Icon = portal.icon;
              const isActive = portal.id === activePortalKey;
              return (
                <button
                  key={portal.id}
                  type="button"
                  onClick={() => handleSelectPortal(portal.id)}
                  className={`flex-1 min-w-0 py-2 px-1.5 sm:px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1 sm:gap-1.5 transition-all duration-200 cursor-pointer ${
                    isActive
                      ? portal.activeTabClass
                      : 'text-slate-300 hover:text-white hover:bg-white/10'
                  }`}
                  title={portal.name}
                >
                  <Icon size={14} className="shrink-0" />
                  <span className="hidden sm:inline truncate">{portal.name}</span>
                  <span className="sm:hidden truncate">{portal.shortName || portal.name}</span>
                </button>
              );
            })}
          </div>

          {/* Main Login Card */}
          <div className="bg-white/10 backdrop-blur-xl border border-white/15 rounded-3xl p-6 sm:p-8 shadow-2xl">
            {/* Header: Portal Icon & Titles */}
            <div className="text-center mb-6">
              <div
                className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl border mb-3 shadow-inner ${portalConfig.iconBgClass}`}
              >
                {(() => {
                  const Icon = portalConfig.icon;
                  return <Icon size={26} strokeWidth={2.2} />;
                })()}
              </div>

              <div className="flex justify-center mb-1.5">
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${portalConfig.badgeClass}`}
                >
                  <Shield size={11} />
                  <span>{portalConfig.badge}</span>
                </span>
              </div>

              <h1 className="text-2xl font-black text-white tracking-tight">
                {portalConfig.title}
              </h1>
              <p className="text-xs text-blue-100/70 mt-1 max-w-md mx-auto">
                {portalConfig.subtitle}
              </p>
            </div>

            {/* Active Session Role Mismatch Notice */}
            {isSessionMismatched && (
              <div className="mb-5 p-3.5 rounded-xl bg-amber-500/15 border border-amber-400/30 text-amber-200 text-xs space-y-2.5">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="shrink-0 text-amber-400 mt-0.5" />
                  <div className="leading-relaxed">
                    <p className="font-semibold text-white">Active Session Detected</p>
                    <p className="text-amber-200/90 text-[11px] mt-0.5">
                      You are signed in as <strong className="text-white">{session.user?.email}</strong> with role <strong className="text-amber-300">{role}</strong>.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 border-t border-amber-400/20">
                  <button
                    type="button"
                    onClick={handleSwitchAccount}
                    className="flex-1 py-1.5 px-2 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-lg text-[11px] transition cursor-pointer flex items-center justify-center gap-1"
                  >
                    <LogOut size={12} />
                    <span>Switch to {portalConfig.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleContinueCurrentSession}
                    className="flex-1 py-1.5 px-2 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-lg text-[11px] transition cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>Open {role}</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="mb-5 p-3.5 rounded-xl bg-rose-500/15 border border-rose-400/30 text-rose-200 text-xs flex items-start gap-2.5 animate-shake">
                <AlertCircle size={16} className="shrink-0 text-rose-400 mt-0.5" />
                <span className="leading-relaxed font-medium">{error}</span>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5 text-[11px] uppercase tracking-wider">
                  {portalConfig.name} Email Address
                </label>
                <div className="relative">
                  <Mail
                    size={15}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={portalConfig.defaultEmail}
                    className="w-full pl-10 pr-3.5 py-3 rounded-xl bg-white/5 border border-white/15 text-white placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 transition-all font-medium text-xs"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-slate-300 font-semibold text-[11px] uppercase tracking-wider">
                    Password
                  </label>
                </div>
                <div className="relative">
                  <Lock
                    size={15}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-10 pr-10 py-3 rounded-xl bg-white/5 border border-white/15 text-white placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 transition-all font-medium text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full py-3.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-white active:scale-[0.99] shadow-lg transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${portalConfig.btnClass}`}
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Authenticating...</span>
                    </>
                  ) : (
                    <span>Sign In to {portalConfig.name}</span>
                  )}
                </button>
              </div>
            </form>

            {/* Department Security Notice */}
            <div className="mt-6 pt-5 border-t border-white/10 text-center text-[11px] text-slate-400">
              <div className="flex items-center justify-center gap-1.5 text-blue-300 font-semibold mb-1">
                <Shield size={13} className="text-emerald-400" />
                <span>Zero-Trust Role-Based Access Control</span>
              </div>
              <p className="text-[10px] text-slate-400/80">
                Department workspaces are strictly isolated by verified staff role.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
