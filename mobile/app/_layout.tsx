import "../global.css";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, ActivityIndicator } from "react-native";
import { AuthProvider, useAuth } from "@/lib/auth";
import LoginScreen from "./login";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
    },
  },
});

function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f172a" }}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  // No session → show login directly (bypass router)
  if (!session) {
    return <LoginScreen />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0f172a" },
        headerTintColor: "#f8fafc",
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: "#0f172a" },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="campaign/[id]"
        options={{ title: "Campaign", headerShown: false }}
      />
      <Stack.Screen
        name="campaign/new"
        options={{ title: "New Campaign", presentation: "modal" }}
      />
      <Stack.Screen
        name="lead/[id]"
        options={{ title: "Lead Details", presentation: "modal" }}
      />
      <Stack.Screen
        name="enrich/[campaignId]"
        options={{ title: "Enrichment Pipeline", headerShown: false }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <RootNavigator />
        </QueryClientProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
