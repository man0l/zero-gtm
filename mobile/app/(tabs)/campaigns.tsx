/**
 * Campaigns list screen with multiselect and bulk actions (Add tags, Archive, Delete).
 * UI only — actions are placeholders.
 */
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

const IS_WEB = Platform.OS === "web";
import { useRouter } from "expo-router";
import { useState, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCampaigns } from "@/lib/queries";
import { formatRelativeTime, truncate } from "@/lib/utils";
import type { Campaign } from "@/lib/types";

// Mock tag definitions for Add Tags modal (UI only)
const AVAILABLE_TAGS_MOCK = [
  { id: "high-priority", label: "High Priority", color: "#3b82f6" },
  { id: "urgent", label: "Urgent", color: "#ef4444" },
  { id: "review-needed", label: "Review Needed", color: "#f97316" },
  { id: "q4-campaign", label: "Q4 Campaign", color: "#38bdf8" },
  { id: "lead-gen", label: "Lead Gen", color: "#a855f7" },
  { id: "evergreen", label: "Evergreen", color: "#14b8a6" },
  { id: "drafts", label: "Drafts", color: "#94a3b8" },
];

export default function CampaignsScreen() {
  const router = useRouter();
  const { data: campaigns, refetch, isLoading } = useCampaigns();
  const [refreshing, setRefreshing] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [tagModalSelectedIds, setTagModalSelectedIds] = useState<Set<string>>(
    new Set(["high-priority"])
  );
  const [tagSearchQuery, setTagSearchQuery] = useState("");

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const enterSelectionMode = useCallback((initialId?: string) => {
    setSelectionMode(true);
    if (initialId) setSelectedIds((prev) => new Set(prev).add(initialId));
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!campaigns?.length) return;
    const allSelected = selectedIds.size === campaigns.length;
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(campaigns.map((c) => c.id)));
  }, [campaigns, selectedIds.size]);

  const onAddTags = useCallback(() => {
    setTagModalVisible(true);
    setTagSearchQuery("");
  }, []);

  const closeTagModal = useCallback(() => {
    setTagModalVisible(false);
  }, []);

  const toggleTagInModal = useCallback((tagId: string) => {
    setTagModalSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }, []);

  const filteredAvailableTags = tagSearchQuery.trim()
    ? AVAILABLE_TAGS_MOCK.filter((t) =>
        t.label.toLowerCase().includes(tagSearchQuery.toLowerCase())
      )
    : AVAILABLE_TAGS_MOCK;
  const selectedTagsInModal = AVAILABLE_TAGS_MOCK.filter((t) =>
    tagModalSelectedIds.has(t.id)
  );

  const renderAddTagsSheetContent = useCallback(() => (
    <>
      <View className="w-full items-center pt-3 pb-1">
        <View className="w-12 h-1.5 rounded-full bg-slate-600" />
      </View>
      <View className="px-5 py-3 flex-row items-center justify-between border-b border-border">
        <Text className="text-lg font-bold text-foreground">
          Add Tags to {selectedIds.size} Item{selectedIds.size !== 1 ? "s" : ""}
        </Text>
        <Pressable onPress={closeTagModal} hitSlop={12}>
          <Text className="text-primary font-semibold text-base">Done</Text>
        </Pressable>
      </View>
      <View className="p-4">
        <View className="flex-row items-center bg-background border border-border rounded-xl pl-3 pr-4 py-3">
          <Ionicons name="search" size={20} color="#64748b" />
          <TextInput
            value={tagSearchQuery}
            onChangeText={setTagSearchQuery}
            placeholder="Search or create tag..."
            placeholderTextColor="#64748b"
            className="flex-1 ml-3 text-foreground text-sm"
          />
        </View>
      </View>
      <ScrollView
        className="max-h-72 px-4 pb-6"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-2">
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Selected
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {selectedTagsInModal.map((tag) => (
              <Pressable
                key={tag.id}
                onPress={() => toggleTagInModal(tag.id)}
                className="flex-row items-center gap-2 bg-primary/20 border border-primary rounded-full px-3 py-1.5"
              >
                <View
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                <Text className="text-sm font-medium text-primary">
                  {tag.label}
                </Text>
                <Ionicons name="close" size={14} color="#3b82f6" />
              </Pressable>
            ))}
            {selectedTagsInModal.length === 0 && (
              <Text className="text-sm text-muted-foreground">
                No tags selected
              </Text>
            )}
          </View>
        </View>
        <View className="mt-4">
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Available Tags
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {filteredAvailableTags.map((tag) => {
              const isSelected = tagModalSelectedIds.has(tag.id);
              return (
                <Pressable
                  key={tag.id}
                  onPress={() => toggleTagInModal(tag.id)}
                  className="flex-row items-center gap-2 bg-slate-700/80 border border-border rounded-full px-3 py-1.5"
                >
                  <View
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <Text className="text-sm font-medium text-foreground">
                    {tag.label}
                  </Text>
                  {!isSelected && (
                    <Ionicons
                      name="add"
                      size={14}
                      color="#64748b"
                      style={{ marginLeft: 2 }}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
        <Pressable className="mt-6 p-3 rounded-xl border border-dashed border-border flex-row items-center gap-3">
          <Ionicons name="add-circle-outline" size={22} color="#64748b" />
          <Text className="text-sm text-muted-foreground">
            Create new tag "{tagSearchQuery || "..."}"
          </Text>
        </Pressable>
      </ScrollView>
    </>
  ), [
    selectedIds.size,
    tagSearchQuery,
    selectedTagsInModal,
    filteredAvailableTags,
    tagModalSelectedIds,
    closeTagModal,
    toggleTagInModal,
  ]);

  const onArchive = useCallback(() => {
    // UI only — placeholder
  }, []);

  const onDelete = useCallback(() => {
    // UI only — placeholder
  }, []);

  const handleCampaignPress = useCallback(
    (item: Campaign) => {
      if (selectionMode) {
        toggleSelection(item.id);
      } else {
        router.push(`/campaign/${item.id}`);
      }
    },
    [selectionMode, toggleSelection, router]
  );

  const handleCampaignLongPress = useCallback(
    (item: Campaign) => {
      if (!selectionMode) enterSelectionMode(item.id);
    },
    [selectionMode, enterSelectionMode]
  );

  const listData = campaigns || [];
  const allSelected = listData.length > 0 && selectedIds.size === listData.length;

  const renderCampaign = useCallback(
    ({ item }: { item: Campaign }) => {
      const selected = selectedIds.has(item.id);

      const content = (
        <>
          {selectionMode && (
            <Pressable
              onPress={() => toggleSelection(item.id)}
              hitSlop={8}
              className="mr-4"
            >
              <Ionicons
                name={selected ? "checkbox" : "square-outline"}
                size={22}
                color={selected ? "#3b82f6" : "#64748b"}
              />
            </Pressable>
          )}
          <View className="flex-1 min-w-0">
            <View className="flex-row items-start justify-between mb-1">
              <Text
                className="text-base font-semibold text-foreground flex-1 mr-2"
                numberOfLines={2}
              >
                {item.name}
              </Text>
              <Badge variant="status" status={item.status}>
                {item.status}
              </Badge>
            </View>
            <Text
              className="text-sm text-muted-foreground mb-1"
              numberOfLines={1}
            >
              {truncate(item.service_line, 80)}
            </Text>
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-muted-foreground">
                {item.leads?.[0]?.count ?? 0} leads
              </Text>
              <Text className="text-xs text-muted-foreground">
                {formatRelativeTime(item.created_at)}
              </Text>
            </View>
          </View>
        </>
      );

      if (selectionMode) {
        return (
          <Pressable
            onPress={() => handleCampaignPress(item)}
            onLongPress={() => handleCampaignLongPress(item)}
            delayLongPress={300}
          >
            <View
              className={
                selected
                  ? "flex-row items-center mb-px bg-slate-700/60 border-b border-slate-800"
                  : "flex-row items-center mb-px border-b border-border"
              }
              style={{ paddingVertical: 14, paddingHorizontal: 16 }}
            >
              {content}
            </View>
          </Pressable>
        );
      }

      return (
        <Pressable
          onPress={() => handleCampaignPress(item)}
          onLongPress={() => handleCampaignLongPress(item)}
          delayLongPress={300}
        >
          <Card className="mb-3">
            <CardContent>{content}</CardContent>
          </Card>
        </Pressable>
      );
    },
    [
      selectionMode,
      selectedIds,
      handleCampaignPress,
      handleCampaignLongPress,
      toggleSelection,
    ]
  );

  return (
    <View className="flex-1 bg-background">
      {selectionMode && (
        <>
          {/* Contextual bulk actions header */}
          <View className="bg-card border-b border-border px-4 py-3 flex-row items-center justify-between">
            <Pressable onPress={exitSelectionMode} hitSlop={12}>
              <Text className="text-primary font-medium text-base">Cancel</Text>
            </Pressable>
            <Text className="text-lg font-semibold text-foreground absolute left-0 right-0 text-center pointer-events-none">
              {selectedIds.size} Selected
            </Text>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={onAddTags}
                hitSlop={16}
                style={{ padding: 8 }}
                accessibilityLabel="Add tags"
                accessibilityRole="button"
                testID="campaigns-add-tags-button"
              >
                <Ionicons name="pricetag-outline" size={24} color="#3b82f6" />
              </Pressable>
              <Pressable onPress={onArchive} hitSlop={16} style={{ padding: 8 }}>
                <Ionicons name="archive-outline" size={24} color="#94a3b8" />
              </Pressable>
              <Pressable onPress={onDelete} hitSlop={16} style={{ padding: 8 }}>
                <Ionicons name="trash-outline" size={24} color="#ef4444" />
              </Pressable>
            </View>
          </View>
          {/* Select all bar */}
          <Pressable
            onPress={selectAll}
            className="bg-slate-800/50 px-5 py-3 flex-row items-center gap-3 border-b border-border"
          >
            <Ionicons
              name={allSelected ? "checkbox" : "square-outline"}
              size={20}
              color={allSelected ? "#3b82f6" : "#64748b"}
            />
            <Text className="text-sm font-medium text-muted-foreground">
              Select all campaigns in this view
            </Text>
          </Pressable>
        </>
      )}

      <FlatList
        data={listData}
        renderItem={renderCampaign}
        keyExtractor={(item) => item.id}
        contentContainerClassName="p-4 pb-8"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3b82f6"
          />
        }
        ListHeaderComponent={
          !selectionMode ? (
            <Button
              onPress={() => router.push("/campaign/new")}
              className="mb-4"
            >
              + New Campaign
            </Button>
          ) : null
        }
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-muted-foreground text-sm">
              No campaigns yet. Create your first one.
            </Text>
          </View>
        }
      />

      {/* Add Tags modal (bottom sheet style) — UI only. On web use fixed overlay (RN Modal has visibility issues on web). */}
      {tagModalVisible && IS_WEB ? (
        <View
          pointerEvents="box-none"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            justifyContent: "flex-end",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
        >
          <Pressable
            style={{ flex: 1 }}
            onPress={closeTagModal}
            accessibilityLabel="Close modal"
          />
          <View
            pointerEvents="box-none"
            style={{ maxHeight: "85%", width: "100%" }}
          >
            <Pressable
              className="bg-card rounded-t-2xl border-t border-border"
              onStartShouldSetResponder={() => true}
              onPress={(e: any) => e?.stopPropagation?.()}
            >
              {renderAddTagsSheetContent()}
            </Pressable>
          </View>
        </View>
      ) : null}

      {!IS_WEB && (
        <Modal
          visible={tagModalVisible}
          transparent
          animationType="slide"
          onRequestClose={closeTagModal}
          statusBarTranslucent
        >
          <Pressable
            className="bg-black/60"
            onPress={closeTagModal}
            style={{
              flex: 1,
              justifyContent: "flex-end",
              width: "100%",
              height: "100%",
            }}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              style={{ maxHeight: "85%" }}
            >
              <Pressable
                className="bg-card rounded-t-2xl border-t border-border"
                onPress={(e) => e.stopPropagation()}
              >
                {renderAddTagsSheetContent()}
              </Pressable>
            </KeyboardAvoidingView>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}
