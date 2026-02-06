/**
 * Edge Function: list-models
 * Fetches available chat models from OpenAI API using the stored API key.
 * Returns a curated, sorted list of models suitable for the agent.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getSupabaseClient,
  jsonResponse,
  errorResponse,
  handleCors,
} from "../_shared/supabase.ts";

// Models we want to surface (chat-capable). Ordered by preference.
// We'll match against the API response and only return models that exist.
const PREFERRED_MODELS = [
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
  "o4-mini",
  "o3-pro",
  "o3",
  "o3-mini",
  "o1-pro",
  "o1",
  "o1-mini",
];

// Model families to include (prefix match) — catches dated snapshots like gpt-4o-2024-11-20
const CHAT_PREFIXES = [
  "gpt-5",
  "gpt-4.1",
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
  "o4-mini",
  "o3",
  "o1",
  "o4",
];

// Models to exclude (embeddings, TTS, whisper, dall-e, fine-tunes, etc.)
const EXCLUDE_PATTERNS = [
  "embedding",
  "whisper",
  "tts",
  "dall-e",
  "davinci",
  "babbage",
  "moderation",
  "search",
  "similarity",
  "code-",
  "text-",
  "instruct",
  "audio",
  "realtime",
  "transcribe",
  "chatgpt-",
];

function isChatModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();

  // Exclude non-chat models
  if (EXCLUDE_PATTERNS.some((p) => lower.includes(p))) return false;

  // Include if it matches any chat prefix
  return CHAT_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const supabase = getSupabaseClient(req);

  try {
    // Fetch OpenAI API key from DB
    const { data: keyRow } = await supabase
      .from("api_keys")
      .select("api_key")
      .eq("service", "openai")
      .single();

    if (!keyRow?.api_key) {
      return errorResponse(
        "OpenAI API key not configured. Add it in Settings.",
        422,
      );
    }

    // Call OpenAI List Models API
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${keyRow.api_key}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      return errorResponse(`OpenAI API error ${res.status}: ${body}`, 502);
    }

    const data = await res.json();
    const allModels: { id: string; created: number }[] = data.data || [];

    // Filter to chat-capable models
    const chatModels = allModels
      .filter((m) => isChatModel(m.id))
      .map((m) => m.id);

    // Sort: preferred models first (in order), then remaining alphabetically
    const preferredSet = new Set(PREFERRED_MODELS);
    const inPreferred: string[] = [];
    const others: string[] = [];

    for (const id of chatModels) {
      if (preferredSet.has(id)) {
        inPreferred.push(id);
      } else {
        others.push(id);
      }
    }

    // Sort preferred by their index in PREFERRED_MODELS
    inPreferred.sort(
      (a, b) => PREFERRED_MODELS.indexOf(a) - PREFERRED_MODELS.indexOf(b),
    );
    others.sort();

    const sorted = [...inPreferred, ...others];

    return jsonResponse({
      models: sorted,
      total: sorted.length,
    });
  } catch (err) {
    console.error("list-models error:", err);
    return errorResponse(String(err), 500);
  }
});
