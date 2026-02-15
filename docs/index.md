---
layout: default
title: ZeroGTM — AI SDR & Lead Generation Engine
description: "Open-source AI SDR agent for cold email and lead generation. Google Maps scraper, email finder, lead enrichment. Self-hosted, mobile-first. 71% cheaper than human SDRs."
permalink: /
schema: home
---

# ZeroGTM: The Local-First, Agentic GTM Engine

**Stop paying the "SaaS Tax."** Build your proprietary revenue moat with an open-source **AI SDR** agent for **lead generation** and **cold email** outreach.

Traditional B2B outreach is dying under the weight of "spray and pray" volume. ZeroGTM is a precision-engineered, signal-driven engine for **AI cold email outreach** and **lead generation** that turns **Google Maps** into a high-intent lead goldmine—enriched with an **email finder tool**, **lead enrichment software**, and decision-maker discovery, all managed from a mobile-first interface.

---

## How It Works

The **enrichment pipeline** runs in sequence:

1. **Map Scrape** — Hyper-local lead extraction via Google Maps (RapidAPI).
2. **Contact Mining** — Deep-crawl socials, phones, and emails via OpenWeb Ninja.
3. **DM Identification** — Agentic scraping of "About" pages to find true decision makers.
4. **Identity Verification** — Precision **email finder** discovery via Anymail Finder.
5. **Data Sanitization** — Automated validation and casualization (removing "Inc/LLC").

{% include pipeline-diagram.html %}

[Read the full Enrichment Pipeline →]({{ site.baseurl }}/docs/enrichment-pipeline/)

---

## AI SDR Unit Economics: 71% Savings

| Cost Category   | Human SDR (Annual) | ZeroGTM (Annual)      | Variance |
| --------------- | ------------------ | --------------------- | -------- |
| Compensation    | $60,000            | **$0**                | -100%    |
| Tech Stack      | $3,000             | $6,000 (APIs/Compute) | +100%    |
| Management      | $12,000            | $2,000 (Ops/Eng)      | -83%     |
| **Total Cost**  | **$98,000**        | **$28,000**           | **71% Savings** |

{% include economics-diagram.html %}

---

## Mobile-First Sales Engagement

Speed to lead happens on your phone. ZeroGTM gives you:

- **Thumb-friendly UI** — Swipe to approve leads or trigger AI sequences.
- **Offline-first** — View pipeline and research leads without an active connection.
- **Push-to-action** — Real-time intent signals delivered via mobile.

[Set up the Mobile App →]({{ site.baseurl }}/docs/mobile-app/)

---

## Get Started

1. **Clone the repo** and run the stack (Docker, Supabase, workers).
2. **Configure API keys** (RapidAPI, OpenWeb Ninja, Anymail Finder, OpenAI/Anthropic)—see [API keys]({{ site.baseurl }}/docs/api-keys/).
3. **Use the mobile app** to create campaigns and run the enrichment pipeline.

[Getting Started guide →]({{ site.baseurl }}/docs/getting-started/)  
[Features & capabilities →]({{ site.baseurl }}/features/)  
[Compare ZeroGTM vs human SDR & other tools →]({{ site.baseurl }}/compare/)  
[Pricing & plans →]({{ site.baseurl }}/pricing/)  
[Blog: How to scrape Google Maps for B2B leads (2026) →]({{ site.baseurl }}/blog/google-maps-b2b-leads-2026/)  
[Blog: AI SDR vs Human SDR — Real cost breakdown (2026) →]({{ site.baseurl }}/blog/ai-sdr-vs-human-sdr-cost-2026/)  
[Blog: Open source lead enrichment tools compared →]({{ site.baseurl }}/blog/open-source-lead-enrichment-tools-compared/)  
[Blog: Cold email deliverability guide (2026) →]({{ site.baseurl }}/blog/cold-email-deliverability-guide-2026/)

---

## Frequently Asked Questions

**What is ZeroGTM?**  
ZeroGTM is an open-source **AI SDR** and **lead enrichment** engine. It combines a **Google Maps scraper**, **email finder**, and decision-maker discovery into one pipeline you can self-host or run on a hosted tier—aimed at GTM engineers and sales teams who want control and lower cost than human SDRs.

**How does the enrichment pipeline work?**  
Leads are scraped from Google Maps by location and category, then cleaned (website validation). Next, the pipeline finds emails and socials (lead enrichment), identifies decision makers from About pages, and verifies DM emails via an email finder API. Optional steps casualise company names and remove spam. You run each step from the mobile app or via workers.

**Is ZeroGTM really cheaper than a human SDR?**  
Yes. In our model, a human SDR costs about $98k/year (compensation, tech, management). ZeroGTM runs at roughly $28k (APIs and ops)—about **71% savings**—while keeping pipeline control and signal-driven outreach. Self-hosting reduces cost further to infra and API spend only.
