---
layout: default
title: ZeroGTM + Salesforce Integration
description: "How to connect Salesforce with ZeroGTM. Enrich leads from Salesforce in real time. Top workflows, API limits, sync direction. Lead enrichment for Salesforce users."
permalink: /integrations/salesforce/
---

# ZeroGTM + Salesforce Integration

Connect **Salesforce** to **ZeroGTM** to enrich leads and contacts with verified emails and decision makers—without sending your data to a third-party enrichment cloud.

---

## How to connect Salesforce with ZeroGTM

1. **Export or sync leads** — Use Salesforce reports or API to pull leads (or contacts) you want to enrich. ZeroGTM can ingest via CSV, API, or a scheduled sync.
2. **Run the pipeline** — Map scrape (optional), contact mining, DM identification, and email verification run as jobs. You trigger them from the ZeroGTM mobile app or via workers.
3. **Write back (optional)** — Enriched records (emails, phones, DM names) can be pushed back to Salesforce via API or CSV import, so your CRM stays the single source of truth.

ZeroGTM runs on your infra or our hosted tier. Your Salesforce data is not stored in ZeroGTM’s cloud; you control the sync direction and frequency.

---

## Top 3 workflows

1. **Automatically enrich leads from Salesforce in real time** — New or updated leads in a given list or campaign trigger an enrichment job. Verified emails and DMs are appended and (optionally) written back to Salesforce.
2. **Batch enrich before a campaign** — Export a lead list from Salesforce, run the full pipeline (scrape → clean → find emails → find DMs → verify), then import enriched records back or use them in ZeroGTM for sequences.
3. **Keep decision-maker data in sync** — Run DM identification and verification on a schedule for key accounts; update Salesforce contact records so SDRs always have the latest owner or champion.

---

## Technical FAQs

**What are the API limits?**  
ZeroGTM does not impose per-seat API limits. Enrichment is limited by your own API keys (e.g. email finder, Google Maps) and by the workers you run. Check your provider’s rate limits (e.g. Anymail Finder, RapidAPI).

**Which direction does data sync?**  
You choose. Typical flow: leads/contacts flow from Salesforce into ZeroGTM for enrichment; enriched data can be written back to Salesforce via your sync job or API. ZeroGTM does not automatically push to Salesforce unless you configure it.

**Do I need a Salesforce connector or app?**  
Today you can export/import via CSV or use the ZeroGTM API to pull and push records. A dedicated Salesforce connector (OAuth + native sync) is on the roadmap. [Changelog →]({{ site.baseurl }}/changelog/)

---

[All integrations →]({{ site.baseurl }}/integrations/)  
[CRM integrations →]({{ site.baseurl }}/integrations/crm/)  
[Features →]({{ site.baseurl }}/features/)  
[Compare ZeroGTM vs other tools →]({{ site.baseurl }}/compare/)
