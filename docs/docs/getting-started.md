---
layout: default
title: Getting Started
description: "Get started with ZeroGTM: clone the repo, run Docker and Supabase, configure API keys. Set up the mobile app and enrichment pipeline."
permalink: /docs/getting-started/
---

# Getting Started

This guide gets you from zero to running the **lead enrichment** pipeline and **mobile app** for ZeroGTM. For an overview of capabilities and pricing, see [Features]({{ site.baseurl }}/features/) and [Pricing]({{ site.baseurl }}/pricing/); to compare ZeroGTM to human SDRs and other tools, see [Compare]({{ site.baseurl }}/compare/).

---

## Prerequisites

- **Docker** (for Supabase and workers, if self-hosting)
- **Node.js** 18+ (for the mobile app)
- **API keys** (see [API Keys]({{ site.baseurl }}/docs/api-keys/)): RapidAPI (Google Maps), OpenWeb Ninja, Anymail Finder, and optionally OpenAI or Anthropic for AI steps

---

## High-Level Architecture

- **Mobile app** (Expo/React Native) — create campaigns, trigger scrape/clean/enrichment, view leads.
- **Backend** — Supabase (PostgreSQL + Edge Functions). Self-hosted or Supabase Cloud.
- **Workers** — Python jobs on Contabo (or your server): Google Maps scrape, clean leads, find emails, find decision makers, Anymail Finder.
- **Optional**: n8n for extra orchestration (see main README).

Data flows: **Frontend → Edge Function → bulk_jobs table → Worker → leads table**. The app subscribes to job progress via Supabase Realtime.

---

## 1. Clone the Repo

```bash
git clone https://github.com/man0l/cold-email-ninja-app.git
cd cold-email-ninja-app
```

---

## 2. Backend (Supabase)

If you use **self-hosted Supabase** (e.g. Docker Compose with the rest of your stack):

- Run your Supabase stack (DB, Kong, Edge Functions, Realtime).
- Apply migrations from `supabase/migrations/`.
- Set env vars for Edge Functions and workers (see [Self-Hosted]({{ site.baseurl }}/docs/self-hosted/) and [API Keys]({{ site.baseurl }}/docs/api-keys/)).

If you use **Supabase Cloud**, create a project and run `supabase db push` (or apply migrations manually).

---

## 3. Workers (Optional for self-host)

Workers run long-running jobs (scrape, clean, enrichment). Deploy the Docker image from `workers/` to a server (e.g. Contabo), with `.env` for Supabase URL and API keys. See [Self-Hosted]({{ site.baseurl }}/docs/self-hosted/).

---

## 4. Mobile App

```bash
cd mobile
npm install
```

Create a `.env` or set env vars with your Supabase URL and anon key. Then:

```bash
npx expo start
```

Run on a device or simulator. Sign in with Google (OAuth via `auth-relay` Edge Function).

[Full mobile app setup and usage →]({{ site.baseurl }}/docs/mobile-app/)

---

## 5. Configure API Keys

Add your API keys in the app (Settings) or in the worker/server `.env`, depending on whether you use BYOK or platform keys. See [API Keys]({{ site.baseurl }}/docs/api-keys/).

---

## Next Steps

- [Mobile App]({{ site.baseurl }}/docs/mobile-app/) — setup and usage
- [Web / Landing]({{ site.baseurl }}/docs/web-app/) — landing page and web presence
- [Enrichment Pipeline]({{ site.baseurl }}/docs/enrichment-pipeline/) — step-by-step pipeline
- [Self-Hosted]({{ site.baseurl }}/docs/self-hosted/) — full self-host setup
- [API Keys]({{ site.baseurl }}/docs/api-keys/) — which keys and where to set them

**Marketing:** [Features]({{ site.baseurl }}/features/) · [Compare]({{ site.baseurl }}/compare/) · [Pricing]({{ site.baseurl }}/pricing/)
