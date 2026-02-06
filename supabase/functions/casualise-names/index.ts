/**
 * Edge Function: casualise-names
 * Shortens company names to casual conversational form using OpenAI.
 * Matches the logic in execution/casualise_company_name.py.
 *
 * Always uses OpenAI with the same prompt/examples as the Python script.
 * Batches names (25 per OpenAI call) and writes DB updates 25-concurrent.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSupabaseClient, jsonResponse, errorResponse, handleCors } from "../_shared/supabase.ts";

// Same prompt as execution/casualise_company_name.py → openai_casualise_name()
const SYSTEM_PROMPT =
  "You shorten company names for casual outreach. " +
  "Return JSON with key 'names' containing an array of shortened names in the same order as the input.";

const USER_PROMPT_PREFIX =
  "Rules:\n" +
  "- Shorten the company name to its core brand identity — what people actually call the business.\n" +
  "- Remove legal suffixes (Inc, LLC, Ltd, Corp, Company, Co, LP, PLLC, GmbH).\n" +
  "- Remove descriptors and service words (Agency, Services, Group, Partners, Consulting, " +
  "Solutions, Technologies, Media, Studio, Productions, Digital, Builders, Construction, " +
  "Custom, Managed, Provider, Support, Repair, Professional).\n" +
  "- For long names with dashes, taglines, or service descriptions (e.g. 'Acme Corp - Full Service IT Support'), " +
  "keep ONLY the brand part before the dash/description.\n" +
  "- Strip location qualifiers when the brand stands alone (e.g. 'Avantel Plumber of Chicago IL' -> 'Avantel').\n" +
  "- Preserve the core brand (e.g., 'Love AMS' stays 'Love AMS').\n" +
  "- If shortening makes it too short (<2 chars) or removes the brand, keep original.\n" +
  "\nExamples:\n" +
  "AARON FLINT BUILDERS -> Aaron Flint\n" +
  "Westview Construction -> Westview\n" +
  "Redemption Custom Builders LLC -> Redemption\n" +
  "XYZ Agency -> XYZ\n" +
  "Love AMS Professional Services -> Love AMS\n" +
  "Love Mayo Inc. -> Love Mayo\n" +
  "AJ Technology Company - Managed IT support & Services Phoenix -> AJ Technology\n" +
  "Best IT Guru Managed IT Services Provider -> Best IT Guru\n" +
  "Avantel Plumber of Chicago IL -> Avantel\n" +
  "24/7 Quick Fix Plumbers NYC -> Quick Fix Plumbers\n" +
  "Andres Plumbing and Repair -> Andres Plumbing\n" +
  "\nCompany names (return shortened versions in same order as JSON array):\n";

const DB_CONCURRENCY = 25;
const OPENAI_BATCH_SIZE = 25;

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const supabase = getSupabaseClient(req);

  try {
    const { campaign_id, lead_ids } = await req.json();
    if (!campaign_id) return errorResponse("campaign_id required");

    // Get OpenAI key
    const { data: keyRow } = await supabase
      .from("api_keys")
      .select("api_key")
      .eq("service", "openai")
      .single();

    if (!keyRow) return errorResponse("OpenAI API key not configured");

    // Fetch leads needing casualisation
    let query = supabase
      .from("leads")
      .select("id, company_name, company_name_casual")
      .eq("campaign_id", campaign_id)
      .not("company_name", "is", null)
      .is("company_name_casual", null);

    if (lead_ids?.length) {
      query = query.in("id", lead_ids);
    }

    const { data: leads, error } = await query.limit(500);
    if (error) return errorResponse(error.message);
    if (!leads?.length) {
      return jsonResponse({ processed: 0, message: "No leads need casualisation" });
    }

    // Process names in batches via OpenAI (25 names per API call, 25 concurrent DB writes)
    const allUpdates: { id: string; casual: string }[] = [];

    // Fire all OpenAI batch requests concurrently for maximum throughput
    const batchPromises: Promise<void>[] = [];
    for (let i = 0; i < leads.length; i += OPENAI_BATCH_SIZE) {
      const chunk = leads.slice(i, i + OPENAI_BATCH_SIZE);
      const names = chunk.map((l: { company_name: string }) => l.company_name);

      const promise = (async () => {
        try {
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${keyRow.api_key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4.1-nano",
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: USER_PROMPT_PREFIX + JSON.stringify(names) },
              ],
            response_format: { type: "json_object" },
            temperature: 0.2,
            }),
          });

          const result = await response.json();
          if (!result.choices?.[0]?.message?.content) {
            console.error(`OpenAI unexpected response: ${JSON.stringify(result).slice(0, 500)}`);
            throw new Error(`No choices in response: ${result.error?.message || 'unknown'}`);
          }
          const content = JSON.parse(result.choices[0].message.content);
          // Accept various JSON shapes: { names: [...] }, { result: [...] }, or values
          const casualNames: string[] = content.names || content.result || Object.values(content);

          for (let j = 0; j < chunk.length && j < casualNames.length; j++) {
            const casual = (casualNames[j] || "").trim();
            allUpdates.push({
              id: chunk[j].id,
              casual: casual.length >= 2 ? casual : chunk[j].company_name,
            });
          }
        } catch (err) {
          // On OpenAI failure, keep original names
          console.error(`OpenAI batch error: ${err}`);
          for (const lead of chunk) {
            allUpdates.push({ id: lead.id, casual: lead.company_name });
          }
        }
      })();
      batchPromises.push(promise);
    }

    await Promise.all(batchPromises);

    // Write all updates to DB with 25-concurrent writes
    let processed = 0;
    for (let i = 0; i < allUpdates.length; i += DB_CONCURRENCY) {
      const batch = allUpdates.slice(i, i + DB_CONCURRENCY);
      await Promise.all(
        batch.map((item) =>
          supabase
            .from("leads")
            .update({ company_name_casual: item.casual })
            .eq("id", item.id)
        )
      );
      processed += batch.length;
    }

    return jsonResponse({ processed, total: leads.length, campaign_id });
  } catch (err) {
    return errorResponse(String(err), 500);
  }
});
