/**
 * Inline header with back button for screens outside the (tabs) layout.
 * Uses safe area insets so the header clears the Android status bar.
 */
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ScreenHeaderProps {
  title: string;
}

export function ScreenHeader({ title }: ScreenHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      className="border-b border-border bg-background"
      style={{ paddingTop: insets.top }}
    >
      <View
        className="flex-row items-center px-4"
        style={{ height: 56 }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#f8fafc" />
        </Pressable>
        <Text className="text-lg font-bold text-foreground">{title}</Text>
      </View>
    </View>
  );
}
