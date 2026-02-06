/**
 * New Campaign creation screen
 */
import { View, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCreateCampaign } from "@/lib/queries";

export default function NewCampaignScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const createCampaign = useCreateCampaign();
  const [name, setName] = useState("");
  const [serviceLine, setServiceLine] = useState("");
  const [summarizePrompt, setSummarizePrompt] = useState(
    "You're provided a Markdown scrape of a website page. Your task is to provide a two-paragraph abstract of what this page is about.\n\nReturn in this JSON format:\n\n{\"abstract\":\"your abstract goes here\"}\n\nRules:\n- Your extract should be comprehensive.\n- Use a straightforward, spartan tone of voice.\n- If it's empty, just say \"no content\"."
  );
  const [icebreakerPrompt, setIcebreakerPrompt] = useState("");

  const handleCreate = async () => {
    if (!name.trim() || !serviceLine.trim()) {
      Alert.alert("Error", "Name and Service Line are required.");
      return;
    }
    if (!summarizePrompt.trim() || !icebreakerPrompt.trim()) {
      Alert.alert("Error", "Both prompts are required.");
      return;
    }

    try {
      await createCampaign.mutateAsync({
        name: name.trim(),
        service_line: serviceLine.trim(),
        summarize_prompt: summarizePrompt.trim(),
        icebreaker_prompt: icebreakerPrompt.trim(),
      });
      router.back();
    } catch (err) {
      Alert.alert("Error", String(err));
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 16 }}
    >
      <Input
        label="Campaign Name"
        value={name}
        onChangeText={setName}
        placeholder="e.g., Marketing Agencies Q1 2026"
      />
      <Input
        label="Service Line"
        value={serviceLine}
        onChangeText={setServiceLine}
        placeholder="What you're offering..."
        multiline
        numberOfLines={3}
      />
      <Input
        label="Summarize Prompt"
        value={summarizePrompt}
        onChangeText={setSummarizePrompt}
        placeholder="Prompt for summarizing scraped pages..."
        multiline
        numberOfLines={6}
      />
      <Input
        label="Icebreaker Prompt"
        value={icebreakerPrompt}
        onChangeText={setIcebreakerPrompt}
        placeholder="Prompt for generating cold email icebreakers..."
        multiline
        numberOfLines={6}
      />
      <Button
        onPress={handleCreate}
        loading={createCampaign.isPending}
        className="mt-2"
      >
        Create Campaign
      </Button>
    </ScrollView>
  );
}
