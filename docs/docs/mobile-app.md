---
layout: default
title: Mobile App Setup and Usage
description: "Set up and use the ZeroGTM mobile app. Mobile-first sales engagement, lead pipeline on mobile. Dashboard, campaigns, jobs, agent, settings."
permalink: /docs/mobile-app/
---

# Mobile App

ZeroGTM is **mobile-first**: run your **lead pipeline on mobile** from a thumb-friendly UI. This doc covers setup and daily usage.

---

## Setup

### Prerequisites

- Node.js 18+
- Expo CLI (or use `npx expo`)

### Install and run

```bash
cd zero-gtm/mobile
npm install
```

Create a `.env` (or export vars) with:

- `EXPO_PUBLIC_SUPABASE_URL` — your Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — anon/public key

Then:

```bash
npx expo start
```

Open on a device (Expo Go) or simulator. Sign in with **Google** (OAuth is handled via the `auth-relay` Edge Function).

---

## Tabs and Screens

The app uses four main tabs (plus Settings):

| Tab | Purpose |
|-----|---------|
| **Dashboard** | Overview, quick access to campaigns and recent activity |
| **Campaigns** | List of campaigns; create new; open campaign detail |
| **Jobs** | Active and past bulk jobs (scrape, clean, find emails, find DMs, anymail) |
| **Agent** | AI agent conversation and config |
| **Settings** | Profile, API keys, billing (if enabled) |

Non-tab screens: campaign detail, new campaign, enrichment pipeline, lead detail. Use the header and bottom nav to move between them.

---

## Creating a Campaign

1. Open **Campaigns** → create a new campaign (name, optional service line and prompts).
2. Open the campaign → you’ll see leads (empty at first) and data quality.

---

## Running the Pipeline

From a campaign you can trigger:

1. **Scrape** — Google Maps scrape (adds leads). Configure location/category in the trigger.
2. **Clean** — Website validation and category filter. Removes invalid or off-target leads.
3. **Enrichment** — Choose step: **Find emails** (OpenWeb Ninja), **Find decision makers**, or **Find DM emails** (Anymail Finder).

Jobs run on the worker. Progress shows in **Jobs** and on the campaign; Realtime updates the UI. When a job completes, refresh or navigate back to see updated leads and data quality.

---

## Viewing Leads and Data Quality

- **Leads list** in campaign: columns for company, website, email, decision maker, etc.
- **Lead detail**: full record, ice breaker, enrichment status.
- **Data quality**: counts and status for the campaign (e.g. how many with email, with DM, etc.).

---

## Billing (If Enabled)

If the instance has billing enabled, **Settings** (or a dedicated Billing screen) shows plan and credit balance. You can upgrade and manage subscription via Stripe Customer Portal. BYOK steps don’t deduct credits.

---

Run your **lead enrichment** and **email finder** workflow from your phone: **mobile-first sales engagement** with offline-friendly views and real-time job updates.

[Getting started →]({{ site.baseurl }}/docs/getting-started/)  
[Enrichment pipeline steps →]({{ site.baseurl }}/docs/enrichment-pipeline/)  
[API keys →]({{ site.baseurl }}/docs/api-keys/)  
[Pricing & plans →]({{ site.baseurl }}/pricing/) · [Compare ZeroGTM →]({{ site.baseurl }}/compare/)
