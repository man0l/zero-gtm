---
layout: default
title: API Keys — Email Finder API and Lead Enrichment Tools
description: "ZeroGTM API keys: RapidAPI Google Maps, OpenWeb Ninja, Anymail Finder, OpenAI/Anthropic. Where to set them, BYOK and credits."
permalink: /docs/api-keys/
---

# API Keys

ZeroGTM uses several external APIs for the **enrichment pipeline**: Google Maps (RapidAPI), OpenWeb Ninja, Anymail Finder, and optionally OpenAI or Anthropic. Keys are stored per user or in server env and never logged. You can use your own keys (**BYOK**); when you do, those steps don’t consume plan credits on hosted tiers.

---

## Which APIs

| Service | Used for | Where to get |
|--------|----------|--------------|
| **RapidAPI (Google Maps)** | Map scrape — **Google Maps scraper** lead extraction | RapidAPI |
| **OpenWeb Ninja** | Find emails — **lead enrichment** (emails, phones, socials) | OpenWeb Ninja |
| **Anymail Finder** | Find DM emails — **email finder** for decision makers (email finder by name; email finder by phone number where supported) | Anymail Finder |
| **OpenAI or Anthropic** | Optional: casualise names, AI summaries, agent | OpenAI / Anthropic |

---

## Where to Set Keys

### Mobile app (user-level, BYOK)

In the app **Settings**, you can add **API keys** per service. Those are stored per user (in `api_keys` table). When a job runs, the worker (or Edge Function) can use the user’s key for that service so the step is **BYOK** and doesn’t deduct credits.

### Worker / server

For self-hosted or when the platform provides keys, set env vars on the **worker** (and optionally Edge Functions), e.g.:

- `RAPIDAPI_KEY` (or the key name the Google Maps RapidAPI uses)
- `OPENWEBNINJA_API_KEY` (or similar)
- `ANYMAIL_FINDER_API_KEY` (or similar)
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` for AI steps

Exact names depend on the worker code (see `workers/*.py` and your `.env.example`).

### Edge Functions

If any Edge Function calls an external API (e.g. OpenAI for casualise-names), set the corresponding env in the Supabase/Edge Runtime config.

---

## BYOK and Billing

- **BYOK**: If the user has their own key for a service, the pipeline uses it and **does not deduct credits** for that step.
- **Platform keys**: If the instance is hosted and the user has no key, the platform key is used and credits are deducted per lead/step according to the plan.

See [Pricing]({{ site.baseurl }}/pricing/) for credit rules and [Self-Hosted]({{ site.baseurl }}/docs/self-hosted/) for server env setup.

ZeroGTM plugs into **email finder** and **lead enrichment** providers via **email finder API** and **lead enrichment tools**—using API keys you own (BYOK) or keys supplied by the platform.

[Getting started →]({{ site.baseurl }}/docs/getting-started/)  
[Enrichment pipeline →]({{ site.baseurl }}/docs/enrichment-pipeline/)  
[Self-hosted →]({{ site.baseurl }}/docs/self-hosted/)  
[Pricing →]({{ site.baseurl }}/pricing/)  
[Features →]({{ site.baseurl }}/features/) · [Compare →]({{ site.baseurl }}/compare/)
