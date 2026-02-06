/**
 * AI Agent chat screen.
 * Chat interface powered by OpenAI function calling that orchestrates
 * the enrichment pipeline via the ai-agent Edge Function.
 */
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useState, useRef, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/ui/card";
import { useSendAgentMessage } from "@/lib/queries";
import type { AgentMessage, AgentToolLogEntry } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────────

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: AgentToolLogEntry[];
}

// ─── Tool label/icon mapping ─────────────────────────────────────────

const TOOL_LABELS: Record<string, { label: string; icon: string }> = {
  list_campaigns: { label: "List Campaigns", icon: "list-outline" },
  get_campaign_stats: { label: "Campaign Stats", icon: "bar-chart-outline" },
  scrape_google_maps: { label: "Scrape Google Maps", icon: "search-outline" },
  clean_and_validate: { label: "Clean & Validate", icon: "checkmark-circle-outline" },
  find_emails: { label: "Find Emails", icon: "mail-outline" },
  find_decision_makers: { label: "Find Decision Makers", icon: "people-outline" },
  casualise_names: { label: "Casualise Names", icon: "text-outline" },
  get_active_jobs: { label: "Check Jobs", icon: "sync-outline" },
};

// ─── Components ──────────────────────────────────────────────────────

function ToolCallCard({ entry }: { entry: AgentToolLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_LABELS[entry.name] || { label: entry.name, icon: "code-outline" };

  let resultPreview = "";
  try {
    const parsed = JSON.parse(entry.result);
    if (parsed.error) {
      resultPreview = `Error: ${parsed.error}`;
    } else if (parsed.message) {
      resultPreview = parsed.message;
    } else if (parsed.job_id) {
      resultPreview = `Job created: ${parsed.job_id.slice(0, 8)}...`;
    } else if (Array.isArray(parsed)) {
      resultPreview = `${parsed.length} result${parsed.length !== 1 ? "s" : ""}`;
    } else if (parsed.total_leads !== undefined) {
      resultPreview = `${parsed.total_leads} total leads`;
    } else if (parsed.processed !== undefined) {
      resultPreview = `${parsed.processed} processed`;
    } else {
      resultPreview = entry.result.slice(0, 100);
    }
  } catch {
    resultPreview = entry.result.slice(0, 100);
  }

  return (
    <Pressable onPress={() => setExpanded(!expanded)}>
      <View className="bg-slate-800/60 rounded-lg px-3 py-2 my-1 border border-slate-700/50">
        <View className="flex-row items-center">
          <Ionicons
            name={meta.icon as keyof typeof Ionicons.glyphMap}
            size={14}
            color="#94a3b8"
            style={{ marginRight: 6 }}
          />
          <Text className="text-xs font-semibold text-slate-300 flex-1">
            {meta.label}
          </Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={12}
            color="#64748b"
          />
        </View>
        <Text className="text-xs text-slate-400 mt-1" numberOfLines={expanded ? undefined : 1}>
          {expanded ? entry.result : resultPreview}
        </Text>
      </View>
    </Pressable>
  );
}

function MessageBubble({ msg }: { msg: DisplayMessage }) {
  const isUser = msg.role === "user";

  return (
    <View className={`mb-3 ${isUser ? "items-end" : "items-start"}`}>
      {/* Tool calls (shown before assistant reply) */}
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <View className="w-full max-w-[90%] mb-1">
          {msg.toolCalls.map((tc, i) => (
            <ToolCallCard key={`${msg.id}-tool-${i}`} entry={tc} />
          ))}
        </View>
      )}

      {/* Message bubble */}
      {msg.content ? (
        <View
          className={`max-w-[85%] rounded-2xl px-4 py-3 ${
            isUser
              ? "bg-primary rounded-br-sm"
              : "bg-card border border-border rounded-bl-sm"
          }`}
        >
          <Text
            className={`text-sm leading-5 ${
              isUser ? "text-primary-foreground" : "text-foreground"
            }`}
          >
            {msg.content}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function TypingIndicator() {
  return (
    <View className="items-start mb-3">
      <View className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 flex-row items-center">
        <ActivityIndicator size="small" color="#3b82f6" />
        <Text className="text-sm text-muted-foreground ml-2">Thinking...</Text>
      </View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────

export default function AgentScreen() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<AgentMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const flatListRef = useRef<FlatList>(null);

  const sendMutation = useSendAgentMessage();

  const sendMessage = useCallback(() => {
    const text = inputText.trim();
    if (!text || sendMutation.isPending) return;

    // Add user message to display
    const userDisplayMsg: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userDisplayMsg]);

    // Build conversation for API
    const newHistory: AgentMessage[] = [
      ...conversationHistory,
      { role: "user", content: text },
    ];

    setInputText("");

    sendMutation.mutate(
      { messages: newHistory },
      {
        onSuccess: (response) => {
          // Extract the final assistant message and tool log
          const assistantMsgs = response.messages.filter(
            (m) => m.role === "assistant" && m.content
          );
          const lastAssistant = assistantMsgs[assistantMsgs.length - 1];

          const assistantDisplayMsg: DisplayMessage = {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: lastAssistant?.content || "I couldn't process that request.",
            toolCalls: response.tool_log.length > 0 ? response.tool_log : undefined,
          };

          setMessages((prev) => [...prev, assistantDisplayMsg]);

          // Update conversation history: user message + assistant response only
          // (tools are handled server-side, we just keep the user/assistant turns)
          setConversationHistory([
            ...newHistory,
            { role: "assistant", content: lastAssistant?.content || "" },
          ]);
        },
        onError: (error) => {
          const errorMsg: DisplayMessage = {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `Something went wrong: ${error.message || "Unknown error"}. Please try again.`,
          };
          setMessages((prev) => [...prev, errorMsg]);
        },
      }
    );
  }, [inputText, conversationHistory, sendMutation]);

  const renderMessage = useCallback(
    ({ item }: { item: DisplayMessage }) => <MessageBubble msg={item} />,
    []
  );

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerClassName="p-4 pb-2"
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: true })
        }
        onLayout={() =>
          flatListRef.current?.scrollToEnd({ animated: false })
        }
        ListEmptyComponent={
          <View className="items-center justify-center py-20">
            <View className="bg-card border border-border rounded-full p-5 mb-4">
              <Ionicons name="chatbubble-ellipses-outline" size={40} color="#3b82f6" />
            </View>
            <Text className="text-lg font-bold text-foreground mb-1">
              Pipeline Agent
            </Text>
            <Text className="text-sm text-muted-foreground text-center px-8 mb-6">
              I can run your enrichment pipeline. Tell me which campaign to work on and what to do.
            </Text>
            <Card className="mx-4 w-full">
              <View className="px-1">
                <Text className="text-xs font-semibold text-muted-foreground mb-2">
                  TRY SAYING
                </Text>
                {[
                  "Show me my campaigns",
                  "Run the full pipeline for my campaign",
                  "What's the status of my jobs?",
                  "Scrape plumbers in the US",
                ].map((suggestion) => (
                  <Pressable
                    key={suggestion}
                    onPress={() => {
                      setInputText(suggestion);
                    }}
                    className="py-2 border-b border-border/50"
                  >
                    <Text className="text-sm text-blue-400">{suggestion}</Text>
                  </Pressable>
                ))}
              </View>
            </Card>
          </View>
        }
        ListFooterComponent={sendMutation.isPending ? <TypingIndicator /> : null}
      />

      {/* Input bar */}
      <View className="border-t border-border bg-card px-4 py-3">
        <View className="flex-row items-end">
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask the agent..."
            placeholderTextColor="#64748b"
            multiline
            maxLength={2000}
            returnKeyType="default"
            onSubmitEditing={sendMessage}
            blurOnSubmit={false}
            className="flex-1 min-h-[40px] max-h-[120px] rounded-xl border border-input bg-background px-4 py-2.5 text-foreground text-sm mr-2"
          />
          <Pressable
            onPress={sendMessage}
            disabled={!inputText.trim() || sendMutation.isPending}
            className={`h-10 w-10 rounded-xl items-center justify-center ${
              inputText.trim() && !sendMutation.isPending
                ? "bg-primary"
                : "bg-primary/30"
            }`}
          >
            {sendMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
