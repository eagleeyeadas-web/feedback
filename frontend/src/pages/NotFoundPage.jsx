import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Compass, Home, ArrowRight, LogIn } from 'lucide-react';

export default function NotFoundPage() {
  const { session, role } = useAuth();
  const navigate = useNavigate();

  const handleReturn = () => {
    if (!session) {
      navigate('/login', { replace: true });
      return;
    }
    const userRole = (role || '').toUpperCase();
    if (userRole === 'TECHNICAL') navigate('/technical', { replace: true });
    else if (userRole === 'STORE_MANAGER') navigate('/store-manager', { replace: true });
    else if (userRole === 'COORDINATOR') navigate('/coordinator', { replace: true });
    else if (userRole === 'HR') navigate('/hr', { replace: true });
    else navigate('/sales', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden text-center">
        {/* Header banner */}
        <div className="bg-gradient-to-r from-slate-800 to-navy p-6 text-white flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center mb-3 shadow-inner">
            <Compass size={32} className="text-white" />
          </div>
          <span className="text-xs uppercase tracking-widest font-bold bg-white/20 px-3 py-1 rounded-full text-white/90">
            HTTP 404
          </span>
          <h2 className="text-xl font-bold mt-2">Page Not Found</h2>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600">
            The page or destination you are looking for does not exist, has been moved, or the link may be outdated.
          </p>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={handleReturn}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-navy text-white text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer shadow-md"
            >
              <Home size={15} />
              <span>{session ? 'Return to Workspace' : 'Go to Login'}</span>
            </button>
            <button
              onClick={() => navigate('/', { replace: true })}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              <span>Landing Page</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
