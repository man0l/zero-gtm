/**
 * AI Agent chat screen with conversation history.
 * Chat interface powered by OpenAI function calling that orchestrates
 * the enrichment pipeline via the ai-agent Edge Function.
 *
 * Features:
 * - Send messages via Enter (web) or send button
 * - Full conversation persistence (messages + tool logs)
 * - Slide-down history panel to browse/resume previous chats
 * - Auto-save after each exchange
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
  Modal,
} from "react-native";
import { useState, useRef, useCallback, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/card";
import {
  useSendAgentMessage,
  useAgentConversations,
  useSaveConversation,
  useDeleteConversation,
  useJobProgress,
  useActiveJobsSince,
} from "@/lib/queries";
import { JOB_TYPE_LABELS } from "@/lib/utils";
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
  create_campaign: { label: "Create Campaign", icon: "add-circle-outline" },
  list_campaigns: { label: "List Campaigns", icon: "list-outline" },
  get_campaign_stats: { label: "Campaign Stats", icon: "bar-chart-outline" },
  scrape_google_maps: { label: "Scrape Google Maps", icon: "search-outline" },
  clean_and_validate: { label: "Clean & Validate", icon: "checkmark-circle-outline" },
  find_emails: { label: "Find Emails", icon: "mail-outline" },
  find_decision_makers: { label: "Find Decision Makers", icon: "people-outline" },
  casualise_names: { label: "Casualise Names", icon: "text-outline" },
  get_active_jobs: { label: "Check Jobs", icon: "sync-outline" },
  get_sample_leads: { label: "Sample Leads", icon: "eye-outline" },
};

// ─── Helpers ─────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Components ──────────────────────────────────────────────────────

// ─── Job Progress Bar ─────────────────────────────────────────────

function JobProgressBar({ jobId }: { jobId: string }) {
  const { data: job } = useJobProgress(jobId);

  if (!job) return null;

  const processed = job.progress?.processed ?? 0;
  const total = job.progress?.total ?? 0;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const isComplete = job.status === "completed";
  const isFailed = job.status === "failed" || job.status === "cancelled";
  const isPending = job.status === "pending";
  const isRunning = job.status === "running";

  // Elapsed time
  let elapsed = "";
  if (job.started_at) {
    const start = new Date(job.started_at).getTime();
    const end = job.completed_at
      ? new Date(job.completed_at).getTime()
      : Date.now();
    const secs = Math.round((end - start) / 1000);
    elapsed =
      secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  return (
    <View className="mt-1.5 bg-slate-900/50 rounded-lg px-3 py-2 border border-slate-700/30">
      {/* Progress bar track */}
      <View className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <View
          className={`h-full rounded-full ${
            isComplete
              ? "bg-green-500"
              : isFailed
                ? "bg-red-500"
                : isPending
                  ? "bg-yellow-500"
                  : "bg-blue-500"
          }`}
          style={{ width: `${isPending ? 5 : Math.max(pct, 2)}%` }}
        />
      </View>

      {/* Status row */}
      <View className="flex-row items-center justify-between mt-1.5">
        <Text className="text-xs text-slate-400">
          {isComplete
            ? `✓ Completed — ${processed} processed`
            : isFailed
              ? `✗ ${job.error?.slice(0, 60) || "Failed"}`
              : isPending
                ? "⏳ Queued — waiting for worker…"
                : `${pct}% — ${processed} / ${total} leads`}
        </Text>
        <View className="flex-row items-center">
          {elapsed ? (
            <Text className="text-xs text-slate-500 mr-1">{elapsed}</Text>
          ) : null}
          {isRunning && (
            <ActivityIndicator
              size="small"
              color="#3b82f6"
              style={{ transform: [{ scale: 0.6 }] }}
            />
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Tool Call Card ───────────────────────────────────────────────

const MAX_EXPANDED_CHARS = 3000;

function ToolCallCard({ entry }: { entry: AgentToolLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_LABELS[entry.name] || { label: entry.name, icon: "code-outline" };

  // ─── Extract job_id for live progress tracking ────────────────
  let jobId: string | null = null;
  try {
    const p = JSON.parse(entry.result);
    if (p.job_id) jobId = p.job_id;
  } catch {
    // ignore
  }

  // ─── Preview text (collapsed) ─────────────────────────────────
  let resultPreview = "";
  try {
    const parsed = JSON.parse(entry.result);
    if (parsed.error) {
      resultPreview = `Error: ${parsed.error}`;
    } else if (parsed.campaign_id && parsed.name) {
      resultPreview = `Created "${parsed.name}"`;
    } else if (parsed.message) {
      resultPreview = parsed.message;
    } else if (parsed.job_id) {
      resultPreview = `Job ${parsed.mode || parsed.type || ""}: ${parsed.job_id.slice(0, 8)}…`;
    } else if (Array.isArray(parsed)) {
      resultPreview = `${parsed.length} result${parsed.length !== 1 ? "s" : ""}`;
    } else if (parsed.total_leads_in_campaign !== undefined) {
      resultPreview = `${parsed.total_leads_in_campaign} leads, ${parsed.category_count || 0} categories`;
    } else if (parsed.total_leads !== undefined) {
      resultPreview = `${parsed.total_leads} total leads`;
    } else if (parsed.processed !== undefined) {
      resultPreview = `${parsed.processed} processed`;
    } else if (parsed.will_process !== undefined) {
      resultPreview = `Will process ${parsed.will_process} leads`;
    } else {
      resultPreview = entry.result.slice(0, 120);
    }
  } catch {
    resultPreview = entry.result.slice(0, 120);
  }

  // ─── Formatted expanded text ──────────────────────────────────
  let formattedResult = "";
  let isTruncated = false;
  if (expanded) {
    try {
      const pretty = JSON.stringify(JSON.parse(entry.result), null, 2);
      isTruncated = pretty.length > MAX_EXPANDED_CHARS;
      formattedResult = isTruncated
        ? pretty.slice(0, MAX_EXPANDED_CHARS)
        : pretty;
    } catch {
      isTruncated = entry.result.length > MAX_EXPANDED_CHARS;
      formattedResult = isTruncated
        ? entry.result.slice(0, MAX_EXPANDED_CHARS)
        : entry.result;
    }
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
        {expanded ? (
          <View style={{ maxHeight: 300 }}>
            <Text
              className="text-xs text-slate-400 mt-1"
              style={{ fontFamily: Platform.OS === "web" ? "monospace" : undefined }}
              selectable
            >
              {formattedResult}
            </Text>
            {isTruncated && (
              <Text className="text-xs text-blue-400 mt-1">
                … output truncated ({Math.round(entry.result.length / 1024)}KB total)
              </Text>
            )}
          </View>
        ) : (
          <Text className="text-xs text-slate-400 mt-1" numberOfLines={1}>
            {resultPreview}
          </Text>
        )}

        {/* Live job progress bar — auto-polls while running */}
        {jobId && <JobProgressBar jobId={jobId} />}
      </View>
    </Pressable>
  );
}

function MessageBubble({ msg }: { msg: DisplayMessage }) {
  const isUser = msg.role === "user";

  return (
    <View className={`mb-3 ${isUser ? "items-end" : "items-start"}`}>
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <View className="w-full max-w-[90%] mb-1">
          {msg.toolCalls.map((tc, i) => (
            <ToolCallCard key={`${msg.id}-tool-${i}`} entry={tc} />
          ))}
        </View>
      )}

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

function TypingIndicator({ sentAt }: { sentAt: number | null }) {
  const { data: activeJobs } = useActiveJobsSince(sentAt, sentAt !== null);

  return (
    <View className="items-start mb-3">
      <View className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 flex-row items-center">
        <ActivityIndicator size="small" color="#3b82f6" />
        <Text className="text-sm text-muted-foreground ml-2">Thinking...</Text>
      </View>

      {/* Live job progress while the agent is working */}
      {activeJobs && activeJobs.length > 0 && (
        <View className="w-full max-w-[90%] mt-2">
          {activeJobs.map((job) => {
            const processed = job.progress?.processed ?? 0;
            const total = job.progress?.total ?? 0;
            const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
            const isRunning = job.status === "running";
            const isPending = job.status === "pending";
            const label = JOB_TYPE_LABELS[job.type] || job.type;

            return (
              <View
                key={job.id}
                className="bg-slate-800/60 rounded-lg px-3 py-2 my-1 border border-slate-700/50"
              >
                <View className="flex-row items-center mb-1.5">
                  <Ionicons
                    name={isRunning ? "sync-outline" : "time-outline"}
                    size={14}
                    color="#94a3b8"
                    style={{ marginRight: 6 }}
                  />
                  <Text className="text-xs font-semibold text-slate-300 flex-1">
                    {label}
                  </Text>
                  <View
                    className={`px-1.5 py-0.5 rounded ${
                      isRunning ? "bg-blue-500/20" : "bg-yellow-500/20"
                    }`}
                  >
                    <Text
                      className={`text-[10px] font-medium ${
                        isRunning ? "text-blue-400" : "text-yellow-400"
                      }`}
                    >
                      {job.status}
                    </Text>
                  </View>
                </View>
                <View className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <View
                    className={`h-full rounded-full ${
                      isPending ? "bg-yellow-500" : "bg-blue-500"
                    }`}
                    style={{ width: `${isPending ? 5 : Math.max(pct, 2)}%` }}
                  />
                </View>
                <Text className="text-xs text-slate-400 mt-1">
                  {isPending
                    ? "Queued — waiting for worker…"
                    : `${pct}% — ${processed} / ${total} leads`}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── History Panel ───────────────────────────────────────────────────

function HistoryPanel({
  visible,
  onClose,
  onSelect,
  onDelete,
  activeId,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  activeId: string | null;
}) {
  const { data: conversations, isLoading } = useAgentConversations();
  const historyInsets = useSafeAreaInsets();

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable className="flex-1" onPress={onClose}>
        <View className="flex-1" />
      </Pressable>
      <View className="bg-card border-t border-border rounded-t-2xl max-h-[60%]">
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
          <Text className="text-base font-bold text-foreground">
            Conversation History
          </Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color="#94a3b8" />
          </Pressable>
        </View>

        {/* List */}
        {isLoading ? (
          <View className="py-8 items-center">
            <ActivityIndicator size="small" color="#3b82f6" />
          </View>
        ) : !conversations?.length ? (
          <View style={{ paddingBottom: historyInsets.bottom }} className="py-8 items-center">
            <Ionicons name="chatbubbles-outline" size={32} color="#475569" />
            <Text className="text-sm text-muted-foreground mt-2">
              No conversations yet
            </Text>
          </View>
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: Math.max(historyInsets.bottom, 16) + 16 }}
            renderItem={({ item }) => {
              const isActive = item.id === activeId;
              return (
                <Pressable
                  onPress={() => {
                    onSelect(item.id);
                    onClose();
                  }}
                  className={`px-4 py-3 border-b border-border/50 flex-row items-center ${
                    isActive ? "bg-primary/10" : ""
                  }`}
                >
                  <View className="flex-1 mr-3">
                    <Text
                      className="text-sm font-medium text-foreground"
                      numberOfLines={1}
                    >
                      {item.title || "Untitled"}
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {item.message_count} messages · {timeAgo(item.updated_at)}
                    </Text>
                  </View>
                  {isActive && (
                    <View className="bg-primary/20 rounded-full px-2 py-0.5 mr-2">
                      <Text className="text-xs text-primary">Active</Text>
                    </View>
                  )}
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      onDelete(item.id);
                    }}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={16} color="#ef4444" />
                  </Pressable>
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────

export default function AgentScreen() {
  const insets = useSafeAreaInsets();

  // Conversation state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<AgentMessage[]>([]);
  const [allToolLogs, setAllToolLogs] = useState<AgentToolLogEntry[]>([]);
  const [inputText, setInputText] = useState("");
  const [historyVisible, setHistoryVisible] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);

  const flatListRef = useRef<FlatList>(null);

  // ─── Auto-suggest: track the last async job for completion ─────
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  const { data: trackedJobData } = useJobProgress(trackedJobId);
  const prevTrackedStatusRef = useRef<string | null>(null);

  const sendMutation = useSendAgentMessage();
  const saveMutation = useSaveConversation();
  const deleteMutation = useDeleteConversation();

  // ─── Auto-suggest on job completion ─────────────────────────────
  // When the tracked job transitions to "completed", pre-fill the
  // input with "Next" so the user can advance with one tap.
  useEffect(() => {
    const status = trackedJobData?.status;
    if (!trackedJobId || !status) return;

    if (status === "completed" && prevTrackedStatusRef.current !== "completed") {
      // Only suggest if input is empty (don't overwrite user typing)
      setInputText((prev) => (prev.trim() === "" ? "Next" : prev));
      setTrackedJobId(null);
    } else if (status === "failed" || status === "cancelled") {
      // Stop tracking dead jobs — let the user decide
      setTrackedJobId(null);
    }

    prevTrackedStatusRef.current = status;
  }, [trackedJobData?.status, trackedJobId]);

  // ─── New chat ───────────────────────────────────────────────────
  const startNewChat = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setConversationHistory([]);
    setAllToolLogs([]);
    setInputText("");
    setSentAt(null);
    setTrackedJobId(null);
    prevTrackedStatusRef.current = null;
  }, []);

  // ─── Load conversation ──────────────────────────────────────────
  const loadConversation = useCallback(async (id: string) => {
    // We fetch full conversation data from the list query cache
    // or directly from DB
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data, error } = await supabase
        .from("agent_conversations")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !data) return;

      setConversationId(data.id);
      setMessages((data.display_messages || []) as DisplayMessage[]);
      setConversationHistory((data.messages || []) as AgentMessage[]);
      setAllToolLogs((data.tool_log || []) as AgentToolLogEntry[]);
      setTrackedJobId(null);
      prevTrackedStatusRef.current = null;
    } catch {
      // ignore
    }
  }, []);

  // ─── Delete conversation ────────────────────────────────────────
  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
      if (id === conversationId) {
        startNewChat();
      }
    },
    [conversationId, deleteMutation, startNewChat],
  );

  // ─── Save conversation to DB ────────────────────────────────────
  const saveToDb = useCallback(
    (
      currentId: string | null,
      displayMsgs: DisplayMessage[],
      history: AgentMessage[],
      toolLogs: AgentToolLogEntry[],
    ) => {
      // Auto-title from first user message
      const firstUserMsg = displayMsgs.find((m) => m.role === "user");
      const title = firstUserMsg
        ? firstUserMsg.content.slice(0, 80)
        : "New conversation";

      const userMsgCount = displayMsgs.filter(
        (m) => m.role === "user",
      ).length;

      saveMutation.mutate(
        {
          id: currentId || undefined,
          title,
          messages: history,
          tool_log: toolLogs,
          display_messages: displayMsgs,
          message_count: userMsgCount,
        },
        {
          onSuccess: (saved) => {
            // Capture the conversation ID if this was a new conversation
            if (!currentId && saved?.id) {
              setConversationId(saved.id);
            }
          },
        },
      );
    },
    [saveMutation],
  );

  // ─── Send message ──────────────────────────────────────────────
  const sendMessage = useCallback(() => {
    const text = inputText.trim();
    if (!text || sendMutation.isPending) return;

    const userDisplayMsg: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    };

    const newDisplayMessages = [...messages, userDisplayMsg];
    setMessages(newDisplayMessages);

    const newHistory: AgentMessage[] = [
      ...conversationHistory,
      { role: "user", content: text },
    ];

    setInputText("");
    setSentAt(Date.now());

    sendMutation.mutate(
      { messages: newHistory, conversation_id: conversationId || undefined },
      {
        onSuccess: (response) => {
          const assistantMsgs = response.messages.filter(
            (m) => m.role === "assistant" && m.content,
          );
          const lastAssistant = assistantMsgs[assistantMsgs.length - 1];

          const assistantDisplayMsg: DisplayMessage = {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content:
              lastAssistant?.content || "I couldn't process that request.",
            toolCalls:
              response.tool_log.length > 0 ? response.tool_log : undefined,
          };

          const updatedDisplay = [...newDisplayMessages, assistantDisplayMsg];
          // Save the FULL conversation messages from the Edge Function.
          // This preserves tool_calls, tool results, and all context so
          // the agent can properly resume conversations with full awareness
          // of campaign IDs, job IDs, and prior tool interactions.
          const updatedHistory = response.messages;
          const updatedToolLogs = [...allToolLogs, ...response.tool_log];

          setMessages(updatedDisplay);
          setConversationHistory(updatedHistory);
          setAllToolLogs(updatedToolLogs);
          setSentAt(null);

          // ─── Auto-suggest next action based on tool results ────
          // Check the LAST tool result to determine what to pre-fill.
          const lastEntry =
            response.tool_log[response.tool_log.length - 1];
          if (lastEntry) {
            try {
              const parsed = JSON.parse(lastEntry.result);
              if (parsed.job_id) {
                // Async job created → track it; when it completes
                // the useEffect above will pre-fill "Next"
                setTrackedJobId(parsed.job_id);
                prevTrackedStatusRef.current = null;
              } else if (parsed.mode === "PREVIEW") {
                // dry_run preview shown → suggest confirmation
                setInputText("Yes, run it");
              }
            } catch {
              // non-JSON result — no suggestion
            }
          }

          // Auto-save
          saveToDb(
            conversationId,
            updatedDisplay,
            updatedHistory,
            updatedToolLogs,
          );
        },
        onError: (error) => {
          setSentAt(null);
          const errorMsg: DisplayMessage = {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `Something went wrong: ${error.message || "Unknown error"}. Please try again.`,
          };
          setMessages((prev) => [...prev, errorMsg]);
        },
      },
    );
  }, [
    inputText,
    messages,
    conversationHistory,
    allToolLogs,
    conversationId,
    sendMutation,
    saveToDb,
  ]);

  // ─── Enter to send (web) ───────────────────────────────────────
  const isWeb = Platform.OS === "web";

  const renderMessage = useCallback(
    ({ item }: { item: DisplayMessage }) => <MessageBubble msg={item} />,
    [],
  );

  // Derive chat title for header
  const chatTitle =
    messages.find((m) => m.role === "user")?.content.slice(0, 40) || null;

  // Tab bar (56) + bottom inset; iOS also needs the header offset
  const kvOffset = Platform.OS === "ios" ? 90 : 56 + insets.bottom;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior="padding"
      keyboardVerticalOffset={kvOffset}
    >
      {/* ─── Chat Header ─── */}
      <View className="flex-row items-center px-4 py-2 border-b border-border bg-card">
        <Pressable
          onPress={() => setHistoryVisible(true)}
          hitSlop={8}
          className="mr-3"
        >
          <Ionicons name="time-outline" size={22} color="#94a3b8" />
        </Pressable>
        <View className="flex-1">
          <Text
            className="text-sm font-medium text-foreground"
            numberOfLines={1}
          >
            {chatTitle || "New Chat"}
          </Text>
          {conversationId && (
            <Text className="text-xs text-muted-foreground">
              Continuing conversation
            </Text>
          )}
        </View>
        <Pressable onPress={startNewChat} hitSlop={8}>
          <Ionicons name="add-circle-outline" size={22} color="#3b82f6" />
        </Pressable>
      </View>

      {/* ─── Messages ─── */}
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
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={40}
                color="#3b82f6"
              />
            </View>
            <Text className="text-lg font-bold text-foreground mb-1">
              Pipeline Agent
            </Text>
            <Text className="text-sm text-muted-foreground text-center px-8 mb-6">
              I can run your enrichment pipeline. Tell me which campaign to work
              on and what to do.
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
                    onPress={() => setInputText(suggestion)}
                    className="py-2 border-b border-border/50"
                  >
                    <Text className="text-sm text-blue-400">{suggestion}</Text>
                  </Pressable>
                ))}
              </View>
            </Card>
          </View>
        }
        ListFooterComponent={
          sendMutation.isPending ? <TypingIndicator sentAt={sentAt} /> : null
        }
      />

      {/* ─── Input bar ─── */}
      <View className="border-t border-border bg-card px-4 py-3">
        <View className="flex-row items-end">
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask the agent..."
            placeholderTextColor="#64748b"
            multiline={!isWeb}
            maxLength={2000}
            returnKeyType="send"
            onSubmitEditing={sendMessage}
            blurOnSubmit={isWeb}
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

      {/* ─── History Modal ─── */}
      <HistoryPanel
        visible={historyVisible}
        onClose={() => setHistoryVisible(false)}
        onSelect={loadConversation}
        onDelete={handleDelete}
        activeId={conversationId}
      />
    </KeyboardAvoidingView>
  );
}
