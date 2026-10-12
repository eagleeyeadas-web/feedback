import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const resolveRole = (email, appRole, userRole, profileRole) => {
    const emailLower = (email || '').toLowerCase();
    if (emailLower === 'sales@gmail.com') return 'SALES';
    if (emailLower === 'tech@gmail.com') return 'TECHNICAL';
    if (emailLower === 'store@gmail.com') return 'STORE_MANAGER';
    if (emailLower === 'eagleeye@gmail.com') return 'SUPER_ADMIN';
    if (emailLower === 'admin@eagleeyesafdrive.com') return 'ADMIN';

    const normalizedApp = (appRole || '').toUpperCase();
    if (normalizedApp === 'SALES' || normalizedApp === 'TECHNICAL' || normalizedApp === 'STORE_MANAGER') {
      return normalizedApp;
    }
    if (normalizedApp === 'ADMIN' || normalizedApp === 'SUPER_ADMIN') {
      return normalizedApp;
    }

    const normalizedProfile = (profileRole || '').toUpperCase();
    if (normalizedProfile === 'ADMIN' || normalizedProfile === 'SUPER_ADMIN') {
      return normalizedProfile;
    }

    const normalizedUser = (userRole || '').toUpperCase();
    if (normalizedUser && normalizedUser !== 'ADMIN' && normalizedUser !== 'SUPER_ADMIN') {
      return normalizedUser;
    }

    return 'ADMIN';
  };

  const fetchProfile = async (user) => {
    if (!user) {
      setProfile(null);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('admin_users')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      const effectiveRole = resolveRole(
        user.email,
        user.app_metadata?.role,
        user.user_metadata?.role,
        data?.role
      );

      if (!error && data) {
        setProfile({
          ...data,
          role: effectiveRole,
        });
      } else {
        // Fallback profile if admin_users record is missing
        setProfile({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || user.email.split('@')[0],
          role: effectiveRole,
        });
      }
    } catch (err) {
      console.warn('Failed to fetch user profile:', err);
    }
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        if (session?.user) {
          await fetchProfile(session.user);
        } else {
          setProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null);
    setProfile(null);
  };

  const role = resolveRole(
    session?.user?.email,
    session?.user?.app_metadata?.role,
    session?.user?.user_metadata?.role,
    profile?.role
  );

  const value = {
    session,
    user: session?.user || null,
    profile,
    role,
    token: session?.access_token || null,
    loading,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

