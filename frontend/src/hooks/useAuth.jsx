import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

const VALID_STAFF_ROLES = ['SALES', 'TECHNICAL', 'STORE_MANAGER', 'ADMIN'];

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (user) => {
    if (!user) {
      setProfile(null);
      return null;
    }
    try {
      const { data, error } = await supabase
        .from('admin_users')
        .select('id, email, full_name, role, is_active')
        .eq('id', user.id)
        .maybeSingle();

      if (error || !data || data.is_active === false) {
        if (data?.is_active === false) {
          console.warn('Staff account is deactivated:', user.email);
        }
        setProfile(null);
        return null;
      }

      // Authoritative role from trusted database record & server-signed auth identity
      let effectiveRole = null;
      const dbRole = data.role ? String(data.role).trim().toUpperCase() : '';
      const DEPARTMENT_ROLES = ['SALES', 'TECHNICAL', 'STORE_MANAGER'];
      const appRole = (user.app_metadata?.role || '').toUpperCase();

      if (DEPARTMENT_ROLES.includes(dbRole)) {
        effectiveRole = dbRole;
      } else if (DEPARTMENT_ROLES.includes(appRole)) {
        effectiveRole = appRole;
      } else if (dbRole === 'ADMIN' || dbRole === 'SUPER_ADMIN' || appRole === 'ADMIN' || appRole === 'SUPER_ADMIN') {
        effectiveRole = 'ADMIN';
      }

      const verifiedProfile = {
        ...data,
        role: effectiveRole,
      };

      setProfile(verifiedProfile);
      return verifiedProfile;
    } catch (err) {
      console.warn('Failed to fetch trusted staff profile:', err);
      setProfile(null);
      return null;
    }
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        await fetchProfile(session.user);
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        if (newSession?.user) {
          await fetchProfile(newSession.user);
        } else {
          setProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;

    // Retrieve user's authorized role from trusted database record
    const userProfile = await fetchProfile(data.user);
    if (!userProfile || !userProfile.role) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      throw new Error('Access denied. Account has no authorized operational role assigned in the database.');
    }

    return {
      ...data,
      profile: userProfile,
      role: userProfile.role,
    };
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Sign out error:', err);
    } finally {
      setSession(null);
      setProfile(null);
    }
  };

  const role = profile?.role || null;

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

