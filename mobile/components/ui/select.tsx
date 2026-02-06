/**
 * Select / Dropdown component for React Native.
 * Uses a Modal with a flat list of options.
 * Styled with NativeWind to match the app's design system.
 */
import { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  FlatList,
  ActivityIndicator,
} from "react-native";

export interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps {
  label?: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  error?: string | null;
  allowCustom?: boolean;
}

export function Select({
  label,
  value,
  options,
  onValueChange,
  placeholder = "Select...",
  loading = false,
  error = null,
  allowCustom = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);

  const selectedLabel =
    options.find((o) => o.value === value)?.label || value || placeholder;

  const handleSelect = useCallback(
    (optionValue: string) => {
      onValueChange(optionValue);
      setOpen(false);
    },
    [onValueChange],
  );

  return (
    <View className="mb-3">
      {label && (
        <Text className="text-xs font-medium text-muted-foreground mb-1">
          {label}
        </Text>
      )}

      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between rounded-md border border-input bg-background px-3 py-2.5"
      >
        <Text
          className={`text-sm flex-1 ${value ? "text-foreground" : "text-muted-foreground"}`}
          numberOfLines={1}
        >
          {loading ? "Loading models..." : selectedLabel}
        </Text>
        {loading ? (
          <ActivityIndicator size="small" className="ml-2" />
        ) : (
          <Text className="text-muted-foreground text-xs ml-2">▼</Text>
        )}
      </Pressable>

      {error && (
        <Text className="text-xs text-destructive mt-1">{error}</Text>
      )}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-center px-6"
          onPress={() => setOpen(false)}
        >
          <Pressable
            className="bg-background rounded-xl max-h-[70%] overflow-hidden border border-border"
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View className="px-4 py-3 border-b border-border">
              <Text className="text-sm font-semibold text-foreground">
                {label || "Select Model"}
              </Text>
            </View>

            {loading ? (
              <View className="py-8 items-center">
                <ActivityIndicator size="large" />
                <Text className="text-sm text-muted-foreground mt-2">
                  Fetching models from OpenAI...
                </Text>
              </View>
            ) : options.length === 0 ? (
              <View className="py-8 items-center px-4">
                <Text className="text-sm text-muted-foreground text-center">
                  {error
                    ? error
                    : "No models available. Make sure your OpenAI API key is configured."}
                </Text>
              </View>
            ) : (
              <FlatList
                data={options}
                keyExtractor={(item) => item.value}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => handleSelect(item.value)}
                    className={`px-4 py-3 border-b border-border/50 ${
                      item.value === value ? "bg-primary/10" : ""
                    }`}
                  >
                    <View className="flex-row items-center justify-between">
                      <Text
                        className={`text-sm ${
                          item.value === value
                            ? "text-primary font-semibold"
                            : "text-foreground"
                        }`}
                      >
                        {item.label}
                      </Text>
                      {item.value === value && (
                        <Text className="text-primary text-xs">✓</Text>
                      )}
                    </View>
                  </Pressable>
                )}
              />
            )}

            {/* Cancel button */}
            <Pressable
              onPress={() => setOpen(false)}
              className="px-4 py-3 border-t border-border items-center"
            >
              <Text className="text-sm text-muted-foreground font-medium">
                Cancel
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
