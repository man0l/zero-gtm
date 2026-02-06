/**
 * Persistent bottom tab bar for screens outside the (tabs) layout.
 * Mirrors the same styling and navigation as the Tabs layout.
 * Uses safe area insets so the bar clears the Android navigation bar.
 */
import { View, Text, Pressable } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TABS = [
  { name: "Dashboard", href: "/", icon: "grid-outline" as const },
  { name: "Campaigns", href: "/campaigns", icon: "megaphone-outline" as const },
  { name: "Jobs", href: "/jobs", icon: "sync-outline" as const },
  { name: "Agent", href: "/agent", icon: "chatbubble-ellipses-outline" as const },
  { name: "Settings", href: "/settings", icon: "settings-outline" as const },
];

export function BottomTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  return (
    <View
      className="border-t border-border bg-background"
      style={{ paddingBottom: insets.bottom }}
    >
      <View className="flex-row" style={{ height: 56 }}>
        {TABS.map((tab) => {
          const isActive =
            tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href);

          return (
            <Pressable
              key={tab.name}
              onPress={() => router.push(tab.href as any)}
              className="flex-1 items-center justify-center"
            >
              <Ionicons
                name={tab.icon}
                size={22}
                color={isActive ? "#3b82f6" : "#64748b"}
              />
              <Text
                className={`text-[10px] mt-0.5 ${
                  isActive ? "text-blue-500" : "text-muted-foreground"
                }`}
              >
                {tab.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
