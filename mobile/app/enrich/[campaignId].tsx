/**
 * Enrichment Pipeline screen - rebuilt with all UX learnings.
 *
 * Learning #1: Readiness checklist for API keys
 * Learning #2: Three speed tiers (instant/fast/slow)
 * Learning #3: Funnel visualization
 * Learning #4: Interactive category picker for clean_leads
 * Learning #5: Data quality metrics
 * Learning #6: Include existing toggle
 * Learning #8: Inline results for instant operations
 * Learning #10: Job heartbeat with elapsed time
 */
import { View, Text, ScrollView, Switch, Alert } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReadinessChecklist } from "@/components/readiness-checklist";
import { DataQualityCard } from "@/components/data-quality";
import { PipelineFunnel } from "@/components/pipeline-funnel";
import { CategoryPicker } from "@/components/category-picker";
import { InlineResult } from "@/components/job-progress";
import { ScreenHeader } from "@/components/screen-header";
import { BottomTabs } from "@/components/bottom-tabs";
import {
  useCampaign,
  useTriggerScrape,
  useTriggerEnrichment,
  useTriggerClean,
  useCasualiseNames,
  useCleanSpam,
  useFixLocations,
  useBulkJobs,
  useDataQuality,
} from "@/lib/queries";
import { Input } from "@/components/ui/input";
import { STEP_REQUIREMENTS } from "@/lib/errors";
import { JOB_TYPE_LABELS, formatRelativeTime } from "@/lib/utils";
import type { BulkJob } from "@/lib/types";

// Learning #2: Speed tier indicators
const TIER_LABELS = {
  instant: { icon: "flash-outline" as const, label: "Instant", color: "text-green-400" },
  fast: { icon: "time-outline" as const, label: "10-60s", color: "text-yellow-400" },
  slow: { icon: "hourglass-outline" as const, label: "2-10 min", color: "text-orange-400" },
};

export default function EnrichmentPipelineScreen() {
  const { campaignId } = useLocalSearchParams<{ campaignId: string }>();
  const { data: campaign } = useCampaign(campaignId);
  const { data: quality } = useDataQuality(campaignId);
  const { data: jobs } = useBulkJobs(campaignId);

  // Scrape Google Maps state
  const [scrapeKeywords, setScrapeKeywords] = useState("");
  const [scrapeMaxLeads, setScrapeMaxLeads] = useState("1000");

  // Learning #6: Include existing toggle
  const [includeExisting, setIncludeExisting] = useState(false);

  // Learning #4: Category picker state
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  // Learning #8: Inline results for instant operations
  const [casualiseResult, setCasualiseResult] = useState<Record<string, unknown> | null>(null);
  const [spamResult, setSpamResult] = useState<Record<string, unknown> | null>(null);
  const [locationsResult, setLocationsResult] = useState<Record<string, unknown> | null>(null);

  const triggerScrape = useTriggerScrape();
  const triggerEnrichment = useTriggerEnrichment();
  const triggerClean = useTriggerClean();
  const casualiseNames = useCasualiseNames();
  const cleanSpam = useCleanSpam();
  const fixLocations = useFixLocations();

  const getActiveJob = (type: string): BulkJob | undefined =>
    jobs?.find((j) => j.type === type && ["pending", "running"].includes(j.status));

  const getLastJob = (type: string): BulkJob | undefined =>
    jobs?.find((j) => j.type === type && j.status === "completed");

  const confirm = (title: string, msg: string, onOk: () => void) =>
    Alert.alert(title, msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Start", onPress: onOk },
    ]);

  const totalLeads = quality?.total || 0;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Enrichment Pipeline" />
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 pb-8"
      >
      {/* Header */}
      <Text className="text-xl font-bold text-foreground mb-1">
        Enrichment Pipeline
      </Text>
      <Text className="text-sm text-muted-foreground mb-4">
        {campaign?.name || "Loading..."} · {totalLeads} leads
      </Text>

      {/* Learning #1: API key readiness */}
      <ReadinessChecklist />

      {/* Learning #3: Funnel visualization */}
      <PipelineFunnel campaignId={campaignId} />

      {/* Learning #6: Include existing toggle */}
      <View className="flex-row items-center justify-between bg-card rounded-xl px-4 py-3 mb-4 border border-border">
        <View>
          <Text className="text-sm font-medium text-foreground">Re-process all leads</Text>
          <Text className="text-xs text-muted-foreground">
            {includeExisting ? "Will re-run on all leads" : "Only new/unenriched leads"}
          </Text>
        </View>
        <Switch
          value={includeExisting}
          onValueChange={setIncludeExisting}
          trackColor={{ false: "#334155", true: "#3b82f6" }}
          thumbColor="#f8fafc"
        />
      </View>

      {/* ==================== PIPELINE STEPS ==================== */}

      {/* Step 1: Scrape Google Maps */}
      <Card className="mb-3">
        <CardHeader>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <View className="w-6 h-6 rounded-full bg-blue-600 items-center justify-center mr-2">
                <Text className="text-xs font-bold text-white">1</Text>
              </View>
              <View className="flex-1">
                <CardTitle className="text-base">Scrape Google Maps</CardTitle>
                <CardDescription>Search keywords across US locations via RapidAPI</CardDescription>
              </View>
            </View>
            <TierBadge tier="slow" />
          </View>
        </CardHeader>
        <CardContent>
          {/* Active scrape job */}
          {getActiveJob("scrape_maps") && (
            <View className="bg-blue-500/10 rounded-lg p-2.5 mb-2">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-blue-400 font-medium">
                  {getActiveJob("scrape_maps")?.progress?.processed || 0} / {getActiveJob("scrape_maps")?.progress?.total || "?"} leads
                  {getActiveJob("scrape_maps")?.progress?.searches !== undefined &&
                    ` · ${getActiveJob("scrape_maps")?.progress?.searches} searches`}
                </Text>
                <Badge variant="status" status={getActiveJob("scrape_maps")!.status}>
                  {getActiveJob("scrape_maps")!.status}
                </Badge>
              </View>
            </View>
          )}
          <LastJobResult job={getLastJob("scrape_maps")} />
          <Input
            label="Keywords"
            value={scrapeKeywords}
            onChangeText={setScrapeKeywords}
            placeholder='e.g. "IT services", "marketing agency"'
            multiline
            numberOfLines={2}
          />
          <Input
            label="Max Leads"
            value={scrapeMaxLeads}
            onChangeText={setScrapeMaxLeads}
            placeholder="1000"
          />
          <Button
            size="sm"
            className="mt-1"
            onPress={() => {
              const keywords = scrapeKeywords
                .split(/[,\n]+/)
                .map((k) => k.trim().replace(/^["']|["']$/g, ""))
                .filter(Boolean);
              if (keywords.length === 0) {
                Alert.alert("Error", "Enter at least one keyword.");
                return;
              }
              const maxLeads = parseInt(scrapeMaxLeads, 10) || 1000;
              Alert.alert(
                "Scrape Google Maps",
                `Search ${keywords.length} keyword${keywords.length > 1 ? "s" : ""} across US locations.\nTarget: ${maxLeads} leads.\nUses RapidAPI credits.`,
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Start Scrape",
                    onPress: () =>
                      triggerScrape.mutate({
                        campaign_id: campaignId,
                        keywords,
                        max_leads: maxLeads,
                      }),
                  },
                ]
              );
            }}
            disabled={!!getActiveJob("scrape_maps")}
            loading={triggerScrape.isPending}
          >
            {getActiveJob("scrape_maps") ? "Scraping..." : "Search Google Maps"}
          </Button>
        </CardContent>
      </Card>

      {/* Step 2: Find Emails */}
      <StepCard
        step="find_emails"
        number={2}
        eligible={includeExisting ? totalLeads : (totalLeads - (quality?.withEmail || 0))}
        activeJob={getActiveJob("find_emails")}
        lastJob={getLastJob("find_emails")}
        onStart={() =>
          confirm(
            "Find Emails",
            `This will use ~${includeExisting ? totalLeads : totalLeads - (quality?.withEmail || 0)} OpenWeb Ninja API credits.`,
            () => triggerEnrichment.mutate({
              campaign_id: campaignId,
              type: "find_emails",
              max_leads: totalLeads,
              include_existing: includeExisting,
            })
          )
        }
        loading={triggerEnrichment.isPending}
      />

      {/* Step 3: Find Decision Makers */}
      <StepCard
        step="find_decision_makers"
        number={3}
        eligible={includeExisting ? totalLeads : (totalLeads - (quality?.withDM || 0))}
        activeJob={getActiveJob("find_decision_makers")}
        lastJob={getLastJob("find_decision_makers")}
        onStart={() =>
          confirm(
            "Find Decision Makers",
            "Crawls about/team pages + OpenAI extraction. Uses OpenAI credits.",
            () => triggerEnrichment.mutate({
              campaign_id: campaignId,
              type: "find_decision_makers",
              max_leads: totalLeads,
              include_existing: includeExisting,
            })
          )
        }
        loading={triggerEnrichment.isPending}
      />

      {/* Step 4: Find DM Emails */}
      <StepCard
        step="anymail_emails"
        number={4}
        eligible={includeExisting ? totalLeads : (totalLeads - (quality?.withDM || 0))}
        activeJob={getActiveJob("anymail_emails")}
        lastJob={getLastJob("anymail_emails")}
        onStart={() =>
          confirm(
            "Anymail Finder",
            "2 credits per valid email found. Continue?",
            () => triggerEnrichment.mutate({
              campaign_id: campaignId,
              type: "anymail_emails",
              max_leads: totalLeads,
              include_existing: includeExisting,
            })
          )
        }
        loading={triggerEnrichment.isPending}
      />

      {/* Step 5: Clean & Validate (with category picker - Learning #4) */}
      <Card className="mb-3">
        <CardHeader>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <View className="w-6 h-6 rounded-full bg-secondary items-center justify-center mr-2">
                <Text className="text-xs font-bold text-foreground">5</Text>
              </View>
              <View className="flex-1">
                <CardTitle className="text-base">Clean & Validate</CardTitle>
                <CardDescription>Filter by category + validate websites (HTTP 200)</CardDescription>
              </View>
            </View>
            <TierBadge tier="fast" />
          </View>
        </CardHeader>
        <CardContent>
          <LastJobResult job={getLastJob("clean_leads")} />
          {showCategoryPicker ? (
            <CategoryPicker
              campaignId={campaignId}
              onConfirm={(categories) => {
                triggerClean.mutate({ campaign_id: campaignId, categories });
                setShowCategoryPicker(false);
              }}
              loading={triggerClean.isPending}
            />
          ) : (
            <Button
              size="sm"
              onPress={() => setShowCategoryPicker(true)}
              disabled={!!getActiveJob("clean_leads")}
              loading={triggerClean.isPending}
            >
              {getActiveJob("clean_leads") ? "Running..." : "Choose Categories & Clean"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Step 6: Casualise Names (instant - Learning #2) */}
      <Card className="mb-3">
        <CardHeader>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <View className="w-6 h-6 rounded-full bg-secondary items-center justify-center mr-2">
                <Text className="text-xs font-bold text-foreground">6</Text>
              </View>
              <View className="flex-1">
                <CardTitle className="text-base">Casualise Names</CardTitle>
                <CardDescription>
                  Remove Inc, LLC, Agency, etc. · {totalLeads - (quality?.withCasual || 0)} remaining
                </CardDescription>
              </View>
            </View>
            <TierBadge tier="instant" />
          </View>
        </CardHeader>
        <CardContent>
          <Button
            size="sm"
            onPress={async () => {
              setCasualiseResult(null);
              const result = await casualiseNames.mutateAsync({ campaign_id: campaignId });
              setCasualiseResult(result);
            }}
            loading={casualiseNames.isPending}
          >
            Casualise Names
          </Button>
          <InlineResult result={casualiseResult} label="Casualised" />
        </CardContent>
      </Card>

      {/* Step 7: Clean Spam (instant - Learning #2) */}
      <Card className="mb-3">
        <CardHeader>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <View className="w-6 h-6 rounded-full bg-secondary items-center justify-center mr-2">
                <Text className="text-xs font-bold text-foreground">7</Text>
              </View>
              <View className="flex-1">
                <CardTitle className="text-base">Clean Spam Keywords</CardTitle>
                <CardDescription>Remove 400+ spam triggers from icebreakers</CardDescription>
              </View>
            </View>
            <TierBadge tier="instant" />
          </View>
        </CardHeader>
        <CardContent>
          <View className="flex-row gap-2">
            <Button
              size="sm"
              variant="secondary"
              onPress={async () => {
                setSpamResult(null);
                const result = await cleanSpam.mutateAsync({ campaign_id: campaignId, use_openai: false });
                setSpamResult(result);
              }}
              loading={cleanSpam.isPending}
            >
              Remove Keywords
            </Button>
            <Button
              size="sm"
              onPress={() =>
                confirm("Rewrite with OpenAI?", "Uses OpenAI credits for natural rewrites.", async () => {
                  setSpamResult(null);
                  const result = await cleanSpam.mutateAsync({ campaign_id: campaignId, use_openai: true });
                  setSpamResult(result);
                })
              }
              loading={cleanSpam.isPending}
            >
              Rewrite with AI
            </Button>
          </View>
          <InlineResult result={spamResult} label="Cleaned" />
        </CardContent>
      </Card>

      {/* Extra: Fix Locations */}
      <Card className="mb-3 border-dashed">
        <CardContent>
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-sm font-medium text-foreground">Fix Locations</Text>
              <Text className="text-xs text-muted-foreground">Normalize city/state/zip</Text>
            </View>
            <Button
              size="sm"
              variant="outline"
              onPress={async () => {
                setLocationsResult(null);
                const result = await fixLocations.mutateAsync({ campaign_id: campaignId });
                setLocationsResult(result);
              }}
              loading={fixLocations.isPending}
            >
              Fix
            </Button>
          </View>
          <InlineResult result={locationsResult} label="Fixed" />
        </CardContent>
      </Card>

      {/* Learning #5: Data quality at the bottom */}
      <DataQualityCard campaignId={campaignId} />
    </ScrollView>
      <BottomTabs />
    </View>
  );
}

/** Reusable step card for worker-based steps */
function StepCard({
  step,
  number,
  eligible,
  activeJob,
  lastJob,
  onStart,
  loading,
}: {
  step: string;
  number: number;
  eligible: number;
  activeJob?: BulkJob;
  lastJob?: BulkJob;
  onStart: () => void;
  loading: boolean;
}) {
  const req = STEP_REQUIREMENTS[step];
  if (!req) return null;

  return (
    <Card className="mb-3">
      <CardHeader>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1">
            <View className="w-6 h-6 rounded-full bg-secondary items-center justify-center mr-2">
              <Text className="text-xs font-bold text-foreground">{number}</Text>
            </View>
            <View className="flex-1">
              <CardTitle className="text-base">{req.label}</CardTitle>
              <CardDescription>{eligible} leads eligible</CardDescription>
            </View>
          </View>
          <TierBadge tier={req.tier} />
        </View>
      </CardHeader>
      <CardContent>
        {/* Active job progress - Learning #10 */}
        {activeJob && (
          <View className="bg-blue-500/10 rounded-lg p-2.5 mb-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-blue-400 font-medium">
                {activeJob.progress?.processed || 0} / {activeJob.progress?.total || "?"}
                {activeJob.progress?.found !== undefined && ` (${activeJob.progress.found} found)`}
              </Text>
              <Badge variant="status" status={activeJob.status}>{activeJob.status}</Badge>
            </View>
          </View>
        )}
        {/* Last job result - Learning #8 */}
        <LastJobResult job={lastJob} />
        <Button
          size="sm"
          onPress={onStart}
          disabled={!!activeJob || eligible === 0}
          loading={loading}
        >
          {activeJob ? "Running..." : eligible === 0 ? "All done" : "Start"}
        </Button>
      </CardContent>
    </Card>
  );
}

function TierBadge({ tier }: { tier: "instant" | "fast" | "slow" }) {
  const info = TIER_LABELS[tier];
  return (
    <View className="flex-row items-center">
      <Ionicons name={info.icon} size={12} color="#64748b" />
      <Text className={`text-xs ml-1 ${info.color}`}>{info.label}</Text>
    </View>
  );
}

function LastJobResult({ job }: { job?: BulkJob }) {
  if (!job?.result) return null;
  return (
    <View className="bg-green-500/10 rounded-lg p-2 mb-2">
      <Text className="text-xs text-green-400">
        Last run: {Object.entries(job.result)
          .filter(([k]) => !["total"].includes(k))
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ")}{" "}
        ({formatRelativeTime(job.completed_at)})
      </Text>
    </View>
  );
}
