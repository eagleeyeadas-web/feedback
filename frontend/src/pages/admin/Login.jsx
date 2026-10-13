import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
} from 'lucide-react';
import Navbar from '../../components/Navbar';

export default function Login() {
  const navigate = useNavigate();
  const { signIn, session, role } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If already authenticated with an authorized role, automatically direct to their workspace
  useEffect(() => {
    if (session && role) {
      if (role === 'SALES') {
        navigate('/sales', { replace: true });
      } else if (role === 'TECHNICAL') {
        navigate('/technical', { replace: true });
      } else if (role === 'STORE_MANAGER') {
        navigate('/store-manager', { replace: true });
      } else if (role === 'ADMIN') {
        navigate('/sales', { replace: true });
      }
    }
  }, [session, role, navigate]);

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
      const userRole = authResult?.role;

      if (!userRole) {
        throw new Error('Your account does not have an authorized staff role assigned in the database. Access denied.');
      }

      // Route strictly to the user's authorized department workspace
      if (userRole === 'SALES') {
        navigate('/sales', { replace: true });
      } else if (userRole === 'TECHNICAL') {
        navigate('/technical', { replace: true });
      } else if (userRole === 'STORE_MANAGER') {
        navigate('/store-manager', { replace: true });
      } else if (userRole === 'ADMIN') {
        navigate('/sales', { replace: true });
      } else {
        throw new Error('Unauthorized role. Access denied.');
      }
    } catch (err) {
      console.error('Authentication failure:', err);
      // Clean, user-friendly error message
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#060f2e] via-[#0a1946] to-[#0c1f54] flex flex-col text-slate-100">
      <Navbar showBackToPortals={true} />

      <div className="flex-1 flex items-center justify-center px-4 py-12 relative">
        {/* Subtle Ambient Radial Glow */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 50% 25%, rgba(59, 130, 246, 0.35) 0%, transparent 65%)',
          }}
        />

        <div className="max-w-md w-full relative z-10">
          {/* Back to Portals link */}
          <div className="mb-6 flex items-center justify-between">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-200/80 hover:text-white transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Back to Public Landing</span>
            </Link>

            <span className="text-[11px] font-medium text-slate-400">
              Eagle Eye SafDrive
            </span>
          </div>

          {/* Main Card */}
          <div className="bg-white/10 backdrop-blur-xl border border-white/15 rounded-3xl p-7 sm:p-8 shadow-2xl">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-500/20 text-blue-300 border border-blue-400/30 mb-4 shadow-inner">
                <Lock size={26} strokeWidth={2.2} />
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                Staff Portal Sign In
              </h1>
              <p className="text-xs text-blue-100/70 mt-1 max-w-xs mx-auto">
                Sign in with your staff credentials. Your authorized department workspace will open automatically.
              </p>
            </div>

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
                  Staff Email Address
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
                    placeholder="e.g. sales@gmail.com"
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
                  className="w-full py-3.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.99] shadow-lg shadow-blue-600/30 hover:shadow-blue-600/40 transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Authenticating...</span>
                    </>
                  ) : (
                    <span>Sign In to Workspace</span>
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
                Authorized access only for Sales, Technical, and Store Manager staff.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
