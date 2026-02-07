/**
 * Login screen — shown when there is no active Supabase session.
 * Offers Google OAuth sign-in via browser redirect.
 */
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

export default function LoginScreen() {
  const { signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      await signInWithGoogle();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-background items-center justify-center px-8">
      {/* Logo / brand area */}
      <View className="items-center mb-12">
        <View className="w-20 h-20 rounded-2xl bg-primary/10 items-center justify-center mb-6">
          <Ionicons name="mail-outline" size={40} color="#3b82f6" />
        </View>
        <Text className="text-3xl font-bold text-foreground">Cold Email Ninja</Text>
        <Text className="text-base text-muted-foreground mt-2 text-center">
          Lead enrichment pipelines,{"\n"}powered by AI
        </Text>
      </View>

      {/* Google sign-in button */}
      <Pressable
        onPress={handleGoogleLogin}
        disabled={loading}
        className="w-full flex-row items-center justify-center bg-white rounded-xl py-4 px-6 active:opacity-80"
        style={{ opacity: loading ? 0.6 : 1 }}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#1f2937" />
        ) : (
          <>
            <Ionicons name="logo-google" size={22} color="#4285F4" />
            <Text className="text-base font-semibold text-gray-800 ml-3">
              Continue with Google
            </Text>
          </>
        )}
      </Pressable>

      {error && (
        <Text className="text-red-400 text-sm mt-4 text-center">{error}</Text>
      )}

      <Text className="text-xs text-muted-foreground mt-8 text-center">
        By signing in, you agree to our Terms of Service
      </Text>
    </View>
  );
}
