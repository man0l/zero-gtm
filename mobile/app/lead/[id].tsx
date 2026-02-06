/**
 * Learning #9: Enhanced lead detail card.
 * Shows everything about one lead, organized by enrichment source.
 * Badges for status, tap-to-copy, collapsible raw data.
 */
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLead } from "@/lib/queries";

function CopyField({ label, value, icon }: { label: string; value: string | null; icon?: string }) {
  if (!value) return null;
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(value);
      Alert.alert("Copied", `${label} copied to clipboard`);
    } catch {
      // Clipboard not available
    }
  };
  return (
    <Pressable onPress={copy} className="flex-row items-start mb-2.5 active:opacity-60">
      {icon && (
        <Ionicons
          name={icon as any}
          size={14}
          color="#64748b"
          style={{ marginTop: 2, marginRight: 6 }}
        />
      )}
      <View className="flex-1">
        <Text className="text-xs text-muted-foreground">{label}</Text>
        <Text className="text-sm text-foreground" selectable>
          {value}
        </Text>
      </View>
      <Ionicons name="copy-outline" size={14} color="#475569" style={{ marginTop: 12 }} />
    </Pressable>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View className="mb-2">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="text-sm text-foreground" selectable>
        {value}
      </Text>
    </View>
  );
}

function Section({ title, icon, children, badge }: {
  title: string;
  icon: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <Card className="mb-3">
      <CardHeader>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Ionicons name={icon as any} size={16} color="#3b82f6" />
            <CardTitle className="text-base ml-2">{title}</CardTitle>
          </View>
          {badge}
        </View>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { data: lead } = useLead(id);
  const [showRaw, setShowRaw] = useState(false);

  if (!lead) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted-foreground">Loading...</Text>
      </View>
    );
  }

  // Enrichment badges
  const enrichment = (lead.enrichment_status || {}) as Record<string, unknown>;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 16 }}
    >
      {/* Header */}
      <View className="mb-4">
        <Text className="text-xl font-bold text-foreground">
          {lead.company_name_casual || lead.company_name || "Unknown"}
        </Text>
        {lead.company_name_casual && lead.company_name !== lead.company_name_casual && (
          <Text className="text-xs text-muted-foreground mt-0.5">
            Full: {lead.company_name}
          </Text>
        )}
        <View className="flex-row flex-wrap gap-1.5 mt-2">
          <Badge variant="status" status={lead.ice_status}>{lead.ice_status}</Badge>
          {lead.email && <Badge variant="status" status="done">email</Badge>}
          {lead.decision_maker_name && <Badge variant="status" status="done">DM</Badge>}
          {enrichment.website_validated === true && (
            <Badge variant="status" status="done">valid site</Badge>
          )}
          {enrichment.website_validated === false && (
            <Badge variant="status" status="error">bad site</Badge>
          )}
          {lead.verification_status && (
            <Badge variant="status" status={lead.verification_status === "verified_ok" ? "done" : "error"}>
              {lead.verification_status}
            </Badge>
          )}
        </View>
      </View>

      {/* Company */}
      <Section title="Company" icon="business-outline">
        <CopyField label="Website" value={lead.company_website} icon="globe-outline" />
        <Field label="Domain" value={lead.domain} />
        <Field label="Category" value={lead.category} />
        <Field label="Industry" value={lead.industry} />
        {lead.rating != null && (
          <View className="flex-row items-center mb-2">
            <Ionicons name="star" size={14} color="#eab308" />
            <Text className="text-sm text-foreground ml-1">
              {lead.rating} ({lead.reviews || 0} reviews)
            </Text>
          </View>
        )}
      </Section>

      {/* Contact */}
      <Section
        title="Contact"
        icon="person-outline"
        badge={lead.email ? <Badge variant="status" status="done">found</Badge> : undefined}
      >
        <CopyField label="Email" value={lead.email} icon="mail-outline" />
        <CopyField label="Personal Email" value={lead.personal_email} icon="mail-outline" />
        <CopyField label="Phone" value={lead.phone} icon="call-outline" />
        <CopyField label="LinkedIn" value={lead.linkedin} icon="logo-linkedin" />
        <Field label="Name" value={lead.full_name} />
        <Field label="Title" value={lead.title} />
      </Section>

      {/* Decision Maker */}
      {(lead.decision_maker_name || lead.decision_maker_email) ? (
        <Section
          title="Decision Maker"
          icon="people-outline"
          badge={<Badge variant="status" status="done">found</Badge>}
        >
          <Field label="Name" value={lead.decision_maker_name} />
          <Field label="Title" value={lead.decision_maker_title} />
          <CopyField label="Email" value={lead.decision_maker_email} icon="mail-outline" />
          <CopyField label="LinkedIn" value={lead.decision_maker_linkedin} icon="logo-linkedin" />
          <Field label="Source" value={lead.decision_maker_source} />
          <Field label="Confidence" value={lead.decision_maker_confidence} />
        </Section>
      ) : (
        <Section title="Decision Maker" icon="people-outline">
          <Text className="text-xs text-muted-foreground italic">
            Not found yet. Run "Find Decision Makers" in the enrichment pipeline.
          </Text>
        </Section>
      )}

      {/* Location */}
      <Section title="Location" icon="location-outline">
        <Field label="Address" value={lead.address} />
        <Field
          label="City / State / Zip"
          value={[lead.city, lead.state, lead.zip].filter(Boolean).join(", ") || null}
        />
        <Field label="Country" value={lead.country} />
        {lead.latitude != null && (
          <Field label="Coordinates" value={`${lead.latitude}, ${lead.longitude}`} />
        )}
      </Section>

      {/* Socials */}
      {(lead.social_facebook || lead.social_instagram || lead.social_linkedin || lead.social_twitter) && (
        <Section title="Social Media" icon="share-social-outline">
          <CopyField label="Facebook" value={lead.social_facebook} icon="logo-facebook" />
          <CopyField label="Instagram" value={lead.social_instagram} icon="logo-instagram" />
          <CopyField label="LinkedIn" value={lead.social_linkedin} icon="logo-linkedin" />
          <CopyField label="Twitter/X" value={lead.social_twitter} icon="logo-twitter" />
        </Section>
      )}

      {/* Icebreaker */}
      {lead.ice_breaker && (
        <Section
          title="Icebreaker"
          icon="chatbubble-outline"
          badge={<Badge variant="status" status={lead.ice_status}>{lead.ice_status}</Badge>}
        >
          <Text className="text-sm text-foreground leading-5">{lead.ice_breaker}</Text>
          {lead.ice_breaker_cleaned && lead.ice_breaker_cleaned !== lead.ice_breaker && (
            <View className="mt-3 pt-3 border-t border-border">
              <Text className="text-xs text-muted-foreground mb-1 font-medium">
                Cleaned version:
              </Text>
              <Text className="text-sm text-foreground leading-5">{lead.ice_breaker_cleaned}</Text>
            </View>
          )}
        </Section>
      )}

      {/* Meta */}
      <Section title="Source" icon="information-circle-outline">
        <Field label="Source" value={lead.source} />
        <Field label="Search Keyword" value={lead.search_keyword} />
        <Field label="Search Location" value={lead.search_location} />
        <Field label="Google Place ID" value={lead.place_id} />
      </Section>

      {/* Raw data (collapsible) - Learning #9 */}
      {lead.raw && (
        <Pressable onPress={() => setShowRaw(!showRaw)}>
          <Card className="mb-3">
            <CardContent>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <Ionicons name="code-outline" size={16} color="#64748b" />
                  <Text className="text-sm text-muted-foreground ml-2">Raw Import Data</Text>
                </View>
                <Ionicons
                  name={showRaw ? "chevron-up" : "chevron-down"}
                  size={16}
                  color="#64748b"
                />
              </View>
              {showRaw && (
                <Text className="text-xs text-muted-foreground mt-2 font-mono" selectable>
                  {JSON.stringify(lead.raw, null, 2)}
                </Text>
              )}
            </CardContent>
          </Card>
        </Pressable>
      )}
    </ScrollView>
  );
}
