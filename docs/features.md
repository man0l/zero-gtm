---
layout: default
title: Features — Lead Enrichment Software & Email Finder Tool
description: "ZeroGTM: Google Maps scraper, email finder tool, lead enrichment software. Map scrape, contact mining, DM identification, verification. Self-hosted, mobile-first."
permalink: /features/
schema: features
---

# Features

ZeroGTM is **lead enrichment software** and an **email finder tool** built for GTM engineers who want a **Google Maps scraper**, decision maker discovery, and full control over their data.

---

## The Enrichment Pipeline

End-to-end **lead enrichment** in one flow:

{% include pipeline-diagram.html %}

### 1. Map Scrape (Google Maps Scraper)

Hyper-local lead extraction via RapidAPI. Pull businesses by location, category, and filters—turning **Google Maps** into a structured lead list. No manual copying.

### 2. Contact Mining

Deep-crawl socials, phones, and emails via OpenWeb Ninja. Enriches each lead with contact data so you have more than just a name and address.

### 3. DM Identification

Agentic scraping of "About" pages to find true **decision makers**. Identifies key contacts by role, not just generic info.

### 4. Identity Verification (Email Finder)

Precision **email finder** discovery via Anymail Finder. Validates and finds the right inbox for each decision maker.

### 5. Data Sanitization

Automated HTTP 200 validation and casualization (e.g. removing "Inc/LLC"). Keeps lists clean and deliverability high.

[Full pipeline docs →]({{ site.baseurl }}/docs/enrichment-pipeline/)

---

## Mobile-First Sales Engagement

Run your pipeline from your phone:

- **Thumb-friendly UI** — Swipe to approve leads or trigger sequences.
- **Offline-first** — View pipeline and research without an active connection.
- **Real-time jobs** — Scrape, clean, and enrichment jobs update live.

[Set up the mobile app →]({{ site.baseurl }}/docs/mobile-app/)

---

## Self-Hosted Control

Your data stays yours. ZeroGTM runs on your infra (or optional hosted tier):

- **PostgreSQL** for full data provenance.
- **No black-box sync** — no sending lead data to third-party clouds.
- **BYOK** — use your own API keys for Google Maps, email finder, and enrichment APIs.

[Self-hosted setup →]({{ site.baseurl }}/docs/self-hosted/)

---

## Built for B2B Lead Enrichment

Best for teams that want **b2b lead enrichment tools** and **best lead enrichment for sales teams** without the SaaS tax: GTM engineers, sales ops, and founders running signal-driven outreach. See [use cases]({{ site.baseurl }}/use-cases/) (med spa, dental, HVAC, real estate, personal injury attorney, custom home builders), [integrations]({{ site.baseurl }}/integrations/), [pricing]({{ site.baseurl }}/pricing/), and [compare]({{ site.baseurl }}/compare/) for how ZeroGTM stacks up to human SDRs and other tools.

---

## Frequently Asked Questions

**What is the ZeroGTM enrichment pipeline?**  
The pipeline has five main steps: Map Scrape (Google Maps via RapidAPI), Clean (website validation), Find Emails (OpenWeb Ninja), Find Decision Makers (About page scraping), and Identity Verification (Anymail Finder). Optional steps include casualise company names and clean spam. You run each step from the mobile app or via workers.

**Can I self-host ZeroGTM?**  
Yes. ZeroGTM is open-source. You can run the backend (Supabase or compatible), workers, and optional Edge Functions on your own infrastructure. Your data stays in your PostgreSQL; no lead data is sent to third-party clouds. BYOK (bring your own API keys) is supported for Google Maps, email finder, and enrichment APIs.

**Is ZeroGTM mobile-first?**  
Yes. ZeroGTM has a mobile app (Expo/React Native) with a thumb-friendly UI: swipe to approve leads or trigger sequences, offline-first views, and real-time job updates. You can run the full pipeline and manage campaigns from your phone.

---

[Compare ZeroGTM to human SDRs and other tools →]({{ site.baseurl }}/compare/)  
[Pricing & plans →]({{ site.baseurl }}/pricing/)  
[Get started →]({{ site.baseurl }}/docs/getting-started/)
