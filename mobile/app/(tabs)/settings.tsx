/**
 * Settings screen - API keys & Agent configuration
 */
import { View, Text, ScrollView, Alert, Pressable } from "react-native";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  useApiKeys,
  useSaveApiKey,
  useAgentConfig,
  useSaveAgentConfig,
} from "@/lib/queries";
import type { AgentConfig, AgentToolDefaults } from "@/lib/types";

const API_SERVICES = [
  { key: "openai", label: "OpenAI", desc: "GPT models for enrichment & icebreakers" },
  { key: "openwebninja", label: "OpenWeb Ninja", desc: "Email/contact scraping" },
  { key: "anymail", label: "Anymail Finder", desc: "Decision maker emails" },
  { key: "rapidapi_maps", label: "RapidAPI Maps", desc: "Google Maps scraping" },
  { key: "rapidapi_linkedin", label: "RapidAPI LinkedIn", desc: "LinkedIn data" },
  { key: "dataforseo", label: "DataForSEO", desc: "Search API for LinkedIn" },
];

const TOOL_LABELS: Record<string, string> = {
  list_campaigns: "List Campaigns",
  get_campaign_stats: "Get Campaign Stats",
  scrape_google_maps: "Scrape Google Maps",
  clean_and_validate: "Clean & Validate",
  find_emails: "Find Emails",
  find_decision_makers: "Find Decision Makers",
  casualise_names: "Casualise Names",
  get_sample_leads: "Get Sample Leads",
  get_active_jobs: "Get Active Jobs",
};

const DEFAULT_LABELS: Record<keyof AgentToolDefaults, string> = {
  scrape_max_leads: "Scrape: Max Leads",
  scrape_qa_limit: "Scrape: QA Limit",
  scrape_qa_concurrent: "Scrape: QA Concurrent",
  scrape_full_concurrent: "Scrape: Full Concurrent",
  locations_file: "Scrape: Locations File",
  clean_max_leads: "Clean: Max Leads",
  clean_workers: "Clean: Workers",
  find_emails_max_leads: "Find Emails: Max Leads",
  find_dm_max_leads: "Find DM: Max Leads",
  casualise_batch_size: "Casualise: Batch Size",
  sample_leads_default: "Sample: Default Limit",
  sample_leads_max: "Sample: Max Limit",
  active_jobs_limit: "Jobs: Display Limit",
};

// ─── Collapsible Section ────────────────────────────────────────────

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="mb-3">
      <Pressable onPress={() => setOpen(!open)}>
        <CardHeader className="py-3">
          <View className="flex-row items-center justify-between">
            <CardTitle className="text-sm">{title}</CardTitle>
            <Text className="text-muted-foreground text-xs">
              {open ? "▲" : "▼"}
            </Text>
          </View>
        </CardHeader>
      </Pressable>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { data: existingKeys } = useApiKeys();
  const saveKey = useSaveApiKey();
  const [editingService, setEditingService] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");

  // Agent config
  const { data: agentConfig, isLoading: configLoading } = useAgentConfig();
  const saveConfig = useSaveAgentConfig();

  // Local state for editing
  const [model, setModel] = useState("");
  const [maxIterations, setMaxIterations] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [toolDescs, setToolDescs] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // Populate local state from loaded config
  useEffect(() => {
    if (agentConfig) {
      setModel(agentConfig.model || "");
      setMaxIterations(String(agentConfig.max_iterations || ""));
      setSystemPrompt(agentConfig.system_prompt || "");
      setToolDescs(agentConfig.tool_descriptions || {});
      const d: Record<string, string> = {};
      if (agentConfig.defaults) {
        for (const [k, v] of Object.entries(agentConfig.defaults)) {
          d[k] = String(v);
        }
      }
      setDefaults(d);
      setDirty(false);
    }
  }, [agentConfig]);

  const markDirty = useCallback(() => setDirty(true), []);

  const configuredServices = new Set(
    (existingKeys || []).map((k: { service: string }) => k.service),
  );

  const handleSave = async (service: string) => {
    if (!keyValue.trim()) return;
    try {
      await saveKey.mutateAsync({ service, api_key: keyValue.trim() });
      setEditingService(null);
      setKeyValue("");
      Alert.alert("Saved", `${service} API key saved.`);
    } catch (err) {
      Alert.alert("Error", String(err));
    }
  };

  const handleSaveAgentConfig = async () => {
    try {
      // Convert defaults back to proper types
      const parsedDefaults: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(defaults)) {
        if (k === "locations_file") {
          parsedDefaults[k] = v;
        } else {
          parsedDefaults[k] = Number(v) || 0;
        }
      }

      await saveConfig.mutateAsync({
        model,
        max_iterations: Number(maxIterations) || 10,
        system_prompt: systemPrompt,
        tool_descriptions: toolDescs,
        defaults: parsedDefaults as unknown as AgentToolDefaults,
      } as AgentConfig);

      setDirty(false);
      Alert.alert("Saved", "Agent configuration saved.");
    } catch (err) {
      Alert.alert("Error", String(err));
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="p-4 pb-8"
    >
      {/* ────── API Keys ────── */}
      <Text className="text-lg font-bold text-foreground mb-1">API Keys</Text>
      <Text className="text-sm text-muted-foreground mb-4">
        Configure external service credentials.
      </Text>

      {API_SERVICES.map((svc) => {
        const isConfigured = configuredServices.has(svc.key);
        const isEditing = editingService === svc.key;

        return (
          <Card key={svc.key} className="mb-3">
            <CardContent>
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-sm font-semibold text-foreground">
                  {svc.label}
                </Text>
                <Badge
                  variant="status"
                  status={isConfigured ? "done" : "pending"}
                >
                  {isConfigured ? "configured" : "missing"}
                </Badge>
              </View>
              <Text className="text-xs text-muted-foreground mb-2">
                {svc.desc}
              </Text>

              {isEditing ? (
                <View>
                  <Input
                    value={keyValue}
                    onChangeText={setKeyValue}
                    placeholder="Paste API key..."
                    secureTextEntry
                  />
                  <View className="flex-row gap-2">
                    <Button
                      size="sm"
                      onPress={() => handleSave(svc.key)}
                      loading={saveKey.isPending}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        setEditingService(null);
                        setKeyValue("");
                      }}
                    >
                      Cancel
                    </Button>
                  </View>
                </View>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => {
                    setEditingService(svc.key);
                    setKeyValue("");
                  }}
                >
                  {isConfigured ? "Update Key" : "Add Key"}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* ────── Agent Configuration ────── */}
      <View className="mt-6 mb-4">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-lg font-bold text-foreground">
              Agent Configuration
            </Text>
            <Text className="text-sm text-muted-foreground">
              System prompt, tool descriptions & defaults.
            </Text>
          </View>
          {dirty && (
            <Button
              size="sm"
              onPress={handleSaveAgentConfig}
              loading={saveConfig.isPending}
            >
              Save
            </Button>
          )}
        </View>
        {configLoading && (
          <Text className="text-xs text-muted-foreground mt-1">
            Loading config...
          </Text>
        )}
        {!configLoading && !agentConfig && (
          <Text className="text-xs text-muted-foreground mt-1">
            No saved config — using built-in defaults. Edit and save to
            customise.
          </Text>
        )}
      </View>

      {/* Model & General */}
      <Section title="Model & General" defaultOpen>
        <Input
          label="OpenAI Model"
          value={model}
          onChangeText={(v) => {
            setModel(v);
            markDirty();
          }}
          placeholder="gpt-4o-mini"
        />
        <Input
          label="Max Tool Iterations"
          value={maxIterations}
          onChangeText={(v) => {
            setMaxIterations(v);
            markDirty();
          }}
          placeholder="10"
        />
      </Section>

      {/* System Prompt */}
      <Section title="System Prompt">
        <Input
          value={systemPrompt}
          onChangeText={(v) => {
            setSystemPrompt(v);
            markDirty();
          }}
          placeholder="Enter system prompt..."
          multiline
          numberOfLines={12}
          className="min-h-[200px] text-xs"
        />
      </Section>

      {/* Tool Descriptions */}
      <Section title="Tool Descriptions">
        {Object.entries(TOOL_LABELS).map(([key, label]) => (
          <Input
            key={key}
            label={label}
            value={toolDescs[key] || ""}
            onChangeText={(v) => {
              setToolDescs((prev) => ({ ...prev, [key]: v }));
              markDirty();
            }}
            placeholder={`Description for ${key}`}
            multiline
            numberOfLines={3}
            className="min-h-[60px] text-xs"
          />
        ))}
      </Section>

      {/* Defaults */}
      <Section title="Tool Defaults">
        {Object.entries(DEFAULT_LABELS).map(([key, label]) => (
          <Input
            key={key}
            label={label}
            value={defaults[key] || ""}
            onChangeText={(v) => {
              setDefaults((prev) => ({ ...prev, [key]: v }));
              markDirty();
            }}
            placeholder="0"
          />
        ))}
      </Section>

      {/* Save button at bottom too */}
      {dirty && (
        <Button
          className="mt-2 mb-4"
          onPress={handleSaveAgentConfig}
          loading={saveConfig.isPending}
        >
          Save Agent Configuration
        </Button>
      )}

      {/* System Info */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>System</CardTitle>
        </CardHeader>
        <CardContent>
          <Text className="text-xs text-muted-foreground">
            Supabase: {process.env.EXPO_PUBLIC_SUPABASE_URL}
          </Text>
          <Text className="text-xs text-muted-foreground">Schema: ninja</Text>
          <Text className="text-xs text-muted-foreground">Version: 1.0.0</Text>
        </CardContent>
      </Card>
    </ScrollView>
  );
}
