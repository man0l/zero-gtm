/**
 * Auth context & provider.
 * Tracks the Supabase session and exposes sign-in / sign-out helpers.
 * Works on both native (Android/iOS) and web.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";
import type { Session } from "@supabase/supabase-js";

/* Complete any pending auth sessions on app open (Android) */
if (Platform.OS !== "web") {
  WebBrowser.maybeCompleteAuthSession();
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  signInWithGoogle: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /* Fetch the initial session */
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });

    /* Listen for auth changes (login, logout, token refresh) */
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (Platform.OS === "web") {
      // On web: let Supabase handle the redirect natively (full page redirect)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      // Browser will redirect to Google, then back to our origin
      return;
    }

    // On native: use expo-web-browser for in-app browser OAuth
    const redirectTo = Linking.createURL("auth/callback");

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error) throw error;
    if (!data.url) return;

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (result.type === "success") {
      /* Extract tokens from the redirect URL fragment */
      const url = new URL(result.url);
      const params = new URLSearchParams(
        url.hash ? url.hash.substring(1) : url.search.substring(1)
      );

      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
