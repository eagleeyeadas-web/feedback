import { useState, useEffect, useRef } from 'react';
import {
  Bell,
  BellRing,
  BellOff,
  CheckCircle2,
  AlertTriangle,
  Smartphone,
  Share,
  X,
  Send,
  Loader2,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import {
  getLocalPushStatus,
  subscribeToPush,
  unsubscribeFromPush,
  triggerTestPushNotification,
} from '../../lib/pushManager';

export default function PushNotificationManager({ compact = false }) {
  const { session } = useAuth();
  const token = session?.access_token;

  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState({
    supported: true,
    isSubscribed: false,
    devInfo: {},
    statusLabel: 'Checking...',
  });
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const containerRef = useRef(null);

  // Check status on load
  const refreshStatus = async () => {
    try {
      const res = await getLocalPushStatus(token);
      setStatus(res);
    } catch (e) {
      console.warn('[PUSH] Status check error:', e);
    }
  };

  useEffect(() => {
    refreshStatus();
  }, [token]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSubscribe = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await subscribeToPush(token);
      setMessage('✓ Phone notifications enabled successfully! You will receive system alerts on new checklists.');
      await refreshStatus();
    } catch (err) {
      setError(err.message || 'Failed to enable notifications');
    } finally {
      setLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await unsubscribeFromPush(token);
      setMessage('Notifications disabled for this device.');
      await refreshStatus();
    } catch (err) {
      setError(err.message || 'Failed to disable notifications');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await triggerTestPushNotification(token);
      setMessage(`✓ ${res.message || 'Test notification sent! Check your phone notification bar.'}`);
    } catch (err) {
      setError(err.message || 'Failed to send test push notification');
    } finally {
      setTesting(false);
    }
  };

  const isSubscribed = status.isSubscribed;
  const isBlocked = status.devInfo?.permission === 'denied';
  const requiresHomeScreen = status.devInfo?.requiresHomeScreen;

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={isSubscribed ? 'Mobile Push Notifications Active' : 'Enable Mobile Push Notifications'}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer shadow-2xs ${
          isSubscribed
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
            : isBlocked
            ? 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
            : 'bg-white text-gray-700 hover:text-navy hover:bg-gray-50 border-gray-200'
        }`}
      >
        <span className="relative flex h-3.5 w-3.5 items-center justify-center">
          {isSubscribed ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <BellRing size={14} className="text-emerald-700 relative" />
            </>
          ) : isBlocked ? (
            <BellOff size={14} className="text-rose-600" />
          ) : (
            <Bell size={14} className="text-gray-500" />
          )}
        </span>

        {!compact && (
          <span className="hidden sm:inline">
            {isSubscribed ? 'Alerts Active' : 'Phone Alerts'}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-[calc(100vw-20px)] max-w-xs sm:w-96 rounded-2xl bg-white shadow-2xl border border-gray-200 z-50 p-4 text-xs font-sans animate-in fade-in zoom-in-95 duration-100">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-50 text-blue-700 rounded-lg">
                <Smartphone size={16} />
              </div>
              <div>
                <h4 className="font-bold text-navy text-sm leading-tight">Mobile Push Notifications</h4>
                <p className="text-[10px] text-gray-500">Eagle Eye SafDrive System Alerts</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
            >
              <X size={15} />
            </button>
          </div>

          {/* Status Badge Box */}
          <div className="my-3 p-3 rounded-xl bg-gray-50 border border-gray-100 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-gray-500 font-medium">Device Status:</span>
              <span
                className={`px-2 py-0.5 rounded-full font-bold text-[10px] uppercase tracking-wide border ${
                  isSubscribed
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : isBlocked
                    ? 'bg-rose-100 text-rose-800 border-rose-300'
                    : requiresHomeScreen
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-gray-200 text-gray-700 border-gray-300'
                }`}
              >
                {status.statusLabel}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-gray-600">
              <span>Platform:</span>
              <span className="font-semibold">{status.devInfo?.deviceType || 'Browser'}</span>
            </div>
            <p className="text-[10px] text-gray-500 pt-1 border-t border-gray-200/60 leading-tight">
              Instant alerts appear in your system notification bar when a new installation checklist is created, even if this tab is closed.
            </p>
          </div>

          {/* Alerts / Feedback */}
          {message && (
            <div className="mb-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-start gap-1.5 leading-snug">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-emerald-600" />
              <span>{message}</span>
            </div>
          )}

          {error && (
            <div className="mb-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] flex items-start gap-1.5 leading-snug">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Instructions if Blocked */}
          {isBlocked && (
            <div className="mb-3 p-3 bg-rose-50/70 border border-rose-200 rounded-xl space-y-1 text-rose-900 text-[11px]">
              <p className="font-bold flex items-center gap-1 text-rose-700">
                <AlertTriangle size={13} />
                Notifications blocked in your browser
              </p>
              <p className="text-[10px] text-gray-600 leading-normal">
                To enable alerts, tap the lock or site settings icon in your browser URL bar, change <strong>Notifications</strong> to <strong>Allow</strong>, and refresh the page.
              </p>
            </div>
          )}

          {/* Instructions for iPhone/iOS */}
          {requiresHomeScreen && (
            <div className="mb-3 p-3 bg-blue-50/80 border border-blue-200 rounded-xl space-y-1.5 text-blue-900 text-[11px]">
              <p className="font-bold flex items-center gap-1.5 text-blue-800">
                <Share size={13} />
                iPhone / iPad Setup Required
              </p>
              <p className="text-[10px] text-blue-700 leading-normal">
                Apple iOS requires adding this app to your Home Screen before notifications can be enabled:
              </p>
              <ol className="list-decimal list-inside text-[10px] text-blue-800 space-y-0.5 font-medium">
                <li>Tap the Safari <strong>Share</strong> button (square with arrow)</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
                <li>Open SafDrive from your Home Screen to enable alerts</li>
              </ol>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2 pt-1">
            {!isSubscribed ? (
              <button
                type="button"
                onClick={handleSubscribe}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-3 rounded-xl transition-all shadow-sm disabled:opacity-60 cursor-pointer"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <BellRing size={15} />}
                <span>{loading ? 'Subscribing...' : 'Enable Phone Notifications'}</span>
              </button>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="w-full flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-3 rounded-xl transition-all shadow-xs disabled:opacity-60 cursor-pointer"
                >
                  {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  <span>{testing ? 'Sending test alert...' : 'Send Test Phone Notification'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleUnsubscribe}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-1.5 text-gray-600 hover:text-red-600 hover:bg-red-50 border border-gray-200 hover:border-red-200 font-semibold py-1.5 px-3 rounded-xl transition-all cursor-pointer"
                >
                  <BellOff size={13} />
                  <span>Disable Notifications</span>
                </button>
              </div>
            )}
          </div>

          {/* Footer note */}
          <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
            <span className="flex items-center gap-1">
              <ShieldCheck size={12} className="text-emerald-500" />
              Secure VAPID Web Push
            </span>
            <span>Eagle Eye SafDrive</span>
          </div>
        </div>
      )}
    </div>
  );
}
