import "../global.css";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
    },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
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
    </QueryClientProvider>
  );
}
